import type { Prisma } from "@/generated/prisma/client";
import { toOrderDetail, type OrderDetailDto } from "./order-dto";

export const ORDER_DETAIL_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  currentAttempt: true,
  targetQty: true,
  fabricRollId: true,
  actualFabricYds: true,
  createdAt: true,
  recipe: {
    select: {
      id: true,
      recipeCode: true,
      name: true,
      category: true,
      stdFabricYards: true,
      wastageCap: true,
    },
  },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    orderBy: [{ attemptNo: "asc" as const }, { componentName: "asc" as const }],
    select: {
      attemptNo: true,
      componentId: true,
      componentName: true,
      expectedQty: true,
      actualQty: true,
      status: true,
    },
  },
  logs: {
    orderBy: { attemptNo: "asc" as const },
    select: {
      attemptNo: true,
      decision: true,
      rejectionNote: true,
      expectedFabricYds: true,
      actualFabricYds: true,
      wastagePct: true,
      wastageCapPct: true,
      overCap: true,
      decidedAt: true,
      verifier: { select: { id: true, fullName: true } },
    },
  },
} as const satisfies Prisma.CuttingOrderSelect;

type DetailClient = Pick<Prisma.TransactionClient, "cuttingOrder">;

/** Scope is part of the query, so a verifier never loads a non-pending order. */
export async function getOrderDetailById(
  client: DetailClient,
  id: string,
  options: { pendingOnly?: boolean } = {},
): Promise<OrderDetailDto | null> {
  const row = await client.cuttingOrder.findFirst({
    where: { id, ...(options.pendingOnly ? { status: "PENDING_VERIFICATION" as const } : {}) },
    select: ORDER_DETAIL_SELECT,
    // One SQL statement for the order and its relations. The default sends one per relation, and
    // each is a network round trip.
    relationLoadStrategy: "join",
  });
  return row ? toOrderDetail(row) : null;
}
