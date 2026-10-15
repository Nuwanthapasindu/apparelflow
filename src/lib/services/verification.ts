import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { errors } from "@/lib/api/errors";
import type { AuthUser } from "@/lib/auth/user";
import { prisma } from "@/lib/db";
import { evaluateCount } from "@/lib/domain/traffic-light";
import { calculateWastage } from "@/lib/domain/wastage";
import type { OrderDetailDto } from "@/lib/services/order-dto";
import type { RejectOrderInput, SaveCountsInput } from "@/lib/validation/verification";
import { isOrderId } from "@/lib/validation/order";
import { getOrderDetailById } from "./order-detail";
import { insertAttemptItems } from "./order-items";

const assertVerifier = (user: AuthUser) => {
  if (user.role !== "cutting_verifier") throw errors.forbidden();
};
const assertSupervisor = (user: AuthUser) => {
  if (user.role !== "cutting_supervisor") throw errors.forbidden();
};
const assertOrderId = (id: string) => {
  if (!isOrderId(id)) throw errors.validation({ id: "Enter a valid order id" });
};

type LockedOrder = { id: string; status: OrderStatus; currentAttempt: number };

/** Every Day 3 mutation starts here, before reading or changing item rows. */
export async function lockOrder(tx: Prisma.TransactionClient, id: string): Promise<LockedOrder> {
  const rows = await tx.$queryRaw<{ id: string; status: OrderStatus; current_attempt: number }[]>`
    SELECT id, status, current_attempt
    FROM cutting_orders
    WHERE id = ${id}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw errors.notFound("Order not found");
  return { id: row.id, status: row.status, currentAttempt: row.current_attempt };
}

const requireState = (order: LockedOrder, expected: OrderStatus) => {
  if (order.status !== expected) throw errors.conflict("This order is no longer in the required state");
};

async function detailAfterWrite(tx: Prisma.TransactionClient, orderId: string): Promise<OrderDetailDto> {
  const detail = await getOrderDetailById(tx, orderId);
  if (!detail) throw errors.internal();
  return detail;
}

export async function saveCounts(user: AuthUser, id: string, input: SaveCountsInput): Promise<OrderDetailDto> {
  assertVerifier(user);
  assertOrderId(id);
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireState(order, "PENDING_VERIFICATION");

    const items = await tx.verificationItem.findMany({
      where: { orderId: id, attemptNo: order.currentAttempt, componentId: { in: input.counts.map((row) => row.componentId) } },
      select: { componentId: true, expectedQty: true },
    });
    const expected = new Map(items.map((item) => [item.componentId, item.expectedQty]));
    const fields: Record<string, string> = {};
    input.counts.forEach((row, index) => {
      if (!expected.has(row.componentId)) fields[`counts.${index}.componentId`] = "Component does not belong to this attempt";
    });
    if (Object.keys(fields).length) throw errors.validation(fields);

    for (const row of input.counts) {
      const expectedQty = expected.get(row.componentId)!;
      await tx.verificationItem.update({
        where: { orderId_componentId_attemptNo: { orderId: id, componentId: row.componentId, attemptNo: order.currentAttempt } },
        data: { actualQty: row.actualQty, status: evaluateCount(expectedQty, row.actualQty) },
      });
    }
    return detailAfterWrite(tx, id);
  });
}

export type ApprovalBlockReason = "MISSING" | "UNCOUNTED" | "SHORTAGE";
export type ApprovalBlockingItem = {
  componentId: string;
  componentName: string;
  expectedQty: number;
  actualQty: number | null;
  reason: ApprovalBlockReason;
};

export async function approveOrder(user: AuthUser, id: string): Promise<OrderDetailDto> {
  assertVerifier(user);
  assertOrderId(id);
  return prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, id);
    requireState(locked, "PENDING_VERIFICATION");

    const order = await tx.cuttingOrder.findUniqueOrThrow({
      where: { id },
      select: {
        targetQty: true,
        actualFabricYds: true,
        recipe: {
          select: {
            stdFabricYards: true,
            wastageCap: true,
            components: { orderBy: { componentName: "asc" }, select: { id: true, componentName: true, piecesPerGarment: true } },
          },
        },
        items: {
          where: { attemptNo: locked.currentAttempt },
          select: { componentId: true, componentName: true, expectedQty: true, actualQty: true, status: true },
        },
      },
    });
    const items = new Map(order.items.map((item) => [item.componentId, item]));
    const blocking: ApprovalBlockingItem[] = [];
    for (const component of order.recipe.components) {
      const item = items.get(component.id);
      if (!item) {
        blocking.push({
          componentId: component.id,
          componentName: component.componentName,
          expectedQty: order.targetQty * component.piecesPerGarment,
          actualQty: null,
          reason: "MISSING",
        });
      } else if (item.actualQty === null || item.status === null) {
        blocking.push({
          componentId: item.componentId,
          componentName: item.componentName,
          expectedQty: item.expectedQty,
          actualQty: item.actualQty,
          reason: "UNCOUNTED",
        });
      } else if (item.actualQty < item.expectedQty) {
        blocking.push({
          componentId: item.componentId,
          componentName: item.componentName,
          expectedQty: item.expectedQty,
          actualQty: item.actualQty,
          reason: "SHORTAGE",
        });
      }
    }
    if (blocking.length) {
      throw errors.unprocessable(
        `Cannot approve: ${blocking.length} component${blocking.length === 1 ? " is" : "s are"} missing, uncounted, or short`,
        { blocking },
      );
    }

    const fabric = calculateWastage({
      targetQty: order.targetQty,
      stdFabricYards: order.recipe.stdFabricYards,
      actualFabricYards: order.actualFabricYds,
      wastageCapPct: order.recipe.wastageCap,
    });
    await tx.verificationLog.create({
      data: {
        orderId: id,
        attemptNo: locked.currentAttempt,
        verifierId: user.id,
        decision: "APPROVED",
        expectedFabricYds: fabric.expectedFabricYards,
        actualFabricYds: fabric.actualFabricYards,
        wastagePct: fabric.wastagePct,
        wastageCapPct: fabric.wastageCapPct,
        overCap: fabric.overCap,
      },
    });
    await tx.cuttingOrder.update({ where: { id }, data: { status: "VERIFIED" } });
    return detailAfterWrite(tx, id);
  });
}

export async function rejectOrder(user: AuthUser, id: string, input: RejectOrderInput): Promise<OrderDetailDto> {
  assertVerifier(user);
  assertOrderId(id);
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireState(order, "PENDING_VERIFICATION");
    await tx.verificationLog.create({
      data: {
        orderId: id,
        attemptNo: order.currentAttempt,
        verifierId: user.id,
        decision: "REJECTED",
        rejectionNote: input.note,
      },
    });
    await tx.cuttingOrder.update({ where: { id }, data: { status: "REJECTED" } });
    return detailAfterWrite(tx, id);
  });
}

export async function resubmitOrder(user: AuthUser, id: string): Promise<OrderDetailDto> {
  assertSupervisor(user);
  assertOrderId(id);
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireState(order, "REJECTED");
    const source = await tx.cuttingOrder.findUniqueOrThrow({
      where: { id },
      select: {
        targetQty: true,
        recipe: { select: { components: { select: { id: true, componentName: true, piecesPerGarment: true } } } },
      },
    });
    const nextAttempt = order.currentAttempt + 1;
    await tx.cuttingOrder.update({
      where: { id },
      data: { status: "PENDING_VERIFICATION", currentAttempt: nextAttempt },
    });
    await insertAttemptItems(tx, {
      orderId: id,
      attemptNo: nextAttempt,
      targetQty: source.targetQty,
      components: source.recipe.components,
    });
    return detailAfterWrite(tx, id);
  });
}
