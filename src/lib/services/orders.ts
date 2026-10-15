import type { Role } from "@/generated/prisma/client";
import { errors } from "@/lib/api/errors";
import type { AuthUser } from "@/lib/auth/user";
import { prisma } from "@/lib/db";
import type { CreateOrderInput } from "@/lib/validation/order";
import { isOrderId, MESSAGES } from "@/lib/validation/order";
import type { ListOrdersQuery } from "@/lib/validation/order-query";
import { insertAttemptItems } from "./order-items";
import {
  type OrderDetailDto,
  type OrderListItemDto,
  type RecipeDto,
  toOrderListItem,
} from "./order-dto";
import { readAfterCommit } from "./after-commit";
import { getOrderDetailById } from "./order-detail";

// Services take the authenticated user and are the single code path for route handlers and server
// components. They re-assert the role themselves, so a caller that forgets requireRole still fails.
const SUPERVISOR: Role = "cutting_supervisor";
const assertSupervisor = (user: AuthUser) => {
  if (user.role !== SUPERVISOR) throw errors.forbidden();
};
const assertOrderReader = (user: AuthUser) => {
  if (user.role !== "cutting_supervisor" && user.role !== "cutting_verifier") throw errors.forbidden();
};

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  currentAttempt: true,
  targetQty: true,
  fabricRollId: true,
  actualFabricYds: true,
  createdAt: true,
  recipe: { select: { id: true, recipeCode: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
} as const;

export async function listRecipes(user: AuthUser): Promise<RecipeDto[]> {
  assertSupervisor(user);
  const recipes = await prisma.recipe.findMany({
    orderBy: { recipeCode: "asc" },
    select: {
      id: true,
      recipeCode: true,
      name: true,
      category: true,
      stdFabricYards: true,
      wastageCap: true,
      components: { orderBy: { componentName: "asc" }, select: { id: true, componentName: true, piecesPerGarment: true } },
    },
  });
  return recipes.map((r) => ({
    ...r,
    stdFabricYards: r.stdFabricYards.toFixed(2),
    wastageCap: r.wastageCap.toFixed(2),
  }));
}

/**
 * Create an order and its attempt-1 items in one transaction. Everything the client must not
 * control comes from here: status, attempt, creator, order number, item snapshots.
 */
export async function createOrder(user: AuthUser, input: CreateOrderInput): Promise<OrderDetailDto> {
  assertSupervisor(user);

  const createdId = await prisma.$transaction(async (tx) => {
    const recipe = await tx.recipe.findUnique({
      where: { id: input.recipeId },
      relationLoadStrategy: "join",
      select: { id: true, components: { select: { id: true, componentName: true, piecesPerGarment: true } } },
    });
    if (!recipe) throw errors.validation({ recipeId: MESSAGES.recipeUnknown });

    const [{ order_no: orderNo }] = await tx.$queryRaw<{ order_no: string }[]>`
      SELECT 'CUT-' || lpad(nextval('cutting_order_no_seq')::text, 5, '0') AS order_no`;

    // Built field by field: nothing from the request body is spread into the insert.
    const created = await tx.cuttingOrder.create({
      data: {
        orderNo,
        recipeId: recipe.id,
        targetQty: input.targetQty,
        fabricRollId: input.fabricRollId,
        actualFabricYds: input.actualFabricYds,
        status: "PENDING_VERIFICATION",
        currentAttempt: 1,
        createdById: user.id,
      },
      select: { id: true },
    });

    await insertAttemptItems(tx, {
      orderId: created.id,
      attemptNo: 1,
      targetQty: input.targetQty,
      components: recipe.components,
    });
    return created.id;
  });

  // Read after the commit, so the transaction stays short.
  const detail = await readAfterCommit(() => getOrderDetailById(prisma, createdId));
  if (!detail) throw errors.internal();
  return detail;
}

export async function listOrders(
  user: AuthUser,
  query: ListOrdersQuery,
): Promise<{ orders: OrderListItemDto[]; hasMore: boolean }> {
  assertOrderReader(user);
  if (user.role === "cutting_verifier" && query.status && query.status !== "PENDING_VERIFICATION") {
    throw errors.forbidden("Verifiers may only list orders pending verification");
  }
  const verifier = user.role === "cutting_verifier";
  const rows = await prisma.cuttingOrder.findMany({
    where: verifier ? { status: "PENDING_VERIFICATION" } : query.status ? { status: query.status } : undefined,
    orderBy: verifier ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1, // one extra row tells us whether there is more
    select: ORDER_SELECT,
  });
  return { orders: rows.slice(0, query.limit).map(toOrderListItem), hasMore: rows.length > query.limit };
}

/** Null when the order does not exist; the caller turns that into a 404 (after the role check). */
export async function getOrder(user: AuthUser, id: string): Promise<OrderDetailDto | null> {
  assertOrderReader(user);
  // A malformed id (including a NUL byte, which Postgres refuses in text) cannot exist: not found.
  if (!isOrderId(id)) return null;
  return getOrderDetailById(prisma, id, { pendingOnly: user.role === "cutting_verifier" });
}
