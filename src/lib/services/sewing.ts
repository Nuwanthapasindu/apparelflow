import type { Prisma } from "@/generated/prisma/client";
import { errors } from "@/lib/api/errors";
import type { AuthUser } from "@/lib/auth/user";
import { prisma } from "@/lib/db";
import { MAX_LIMIT } from "@/lib/validation/order-query";
import type { SewingListQuery } from "@/lib/validation/sewing";
import { isOrderId } from "@/lib/validation/order";
import { readAfterCommit } from "./after-commit";
import { SEWING_ORDER_SELECT, type SewingCardDto, type SewingDetailDto, toSewingCard, toSewingDetail } from "./sewing-dto";
import { listSewingQueue } from "./sewing-queue";
import { lockOrder } from "./verification";

// Services take the authenticated user and re-assert the role, so a caller that forgets
// requireRole still fails. The route handlers and the server-rendered pages both come through here.
const assertSewing = (user: AuthUser) => {
  if (user.role !== "sewing_supervisor") throw errors.forbidden();
};

export async function getSewingQueue(user: AuthUser, query: SewingListQuery): Promise<SewingCardDto[]> {
  assertSewing(user);
  return listSewingQueue(query);
}

/**
 * Orders already released to the line. Invariant: only IN_SEWING orders are returned; the status
 * filter is a constant (never a parameter) and is applied again when the rows are loaded. Most
 * recently started first, so the line sees what it just released at the top.
 */
export async function listSewingActive({ limit }: { limit: number }): Promise<SewingCardDto[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError("limit out of range");

  const active = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id
    FROM cutting_orders o
    JOIN verification_logs l
      ON l.order_id = o.id AND l.attempt_no = o.current_attempt AND l.decision = 'APPROVED'
    WHERE o.status = 'IN_SEWING'
    ORDER BY o.sewing_started_at DESC, o.id ASC
    LIMIT ${limit}`;
  if (active.length === 0) return [];

  const rows = await prisma.cuttingOrder.findMany({
    where: { id: { in: active.map((a) => a.id) }, status: "IN_SEWING" },
    select: SEWING_ORDER_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return active.flatMap(({ id }) => {
    const row = byId.get(id);
    const card = row && toSewingCard(row);
    return card ? [card] : [];
  });
}

export async function getSewingActive(user: AuthUser, query: SewingListQuery): Promise<SewingCardDto[]> {
  assertSewing(user);
  return listSewingActive(query);
}

type DetailClient = Pick<Prisma.TransactionClient, "cuttingOrder" | "verificationItem">;

/**
 * One order for the sewing role. Scope is part of the query: only VERIFIED or IN_SEWING orders are
 * found, so a pending, rejected or unknown id is simply null and the caller answers 404, never
 * revealing that the order exists. Only the approved attempt's data is loaded.
 */
async function loadSewingDetail(client: DetailClient, id: string): Promise<SewingDetailDto | null> {
  const row = await client.cuttingOrder.findFirst({
    where: { id, status: { in: ["VERIFIED", "IN_SEWING"] } },
    select: SEWING_ORDER_SELECT,
    relationLoadStrategy: "join",
  });
  if (!row) return null;
  const approved = row.logs.find((log) => log.attemptNo === row.currentAttempt);
  if (!approved) return null;

  const items = await client.verificationItem.findMany({
    where: { orderId: id, attemptNo: approved.attemptNo },
    orderBy: { componentName: "asc" },
    select: { componentName: true, expectedQty: true, actualQty: true, status: true },
  });
  return toSewingDetail(row, items);
}

export async function getSewingOrder(user: AuthUser, id: string): Promise<SewingDetailDto | null> {
  assertSewing(user);
  if (!isOrderId(id)) return null; // ids are UUIDs: anything else cannot exist (and a NUL byte would break Postgres)
  return loadSewingDetail(prisma, id);
}

/**
 * Release a verified batch to the line. Lock the order row first (same lock order as every Day 3
 * mutation), then a guarded update: the WHERE clause only matches a VERIFIED order and exactly one
 * row must change. The starter comes from the session and the time from the database clock, never
 * from the request. The Day 1 triggers are the backstop for the role (GK403) and the field rules.
 */
export async function startSewing(user: AuthUser, id: string): Promise<SewingDetailDto> {
  assertSewing(user);
  if (!isOrderId(id)) throw errors.notFound("Order not found");

  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, id); // 404 when missing
    if (order.status === "IN_SEWING") throw errors.conflict("This batch is already in sewing");
    if (order.status !== "VERIFIED") throw errors.notFound("Order not found"); // pending or rejected: not visible to sewing

    const changed = await tx.$executeRaw`
      UPDATE cutting_orders
      SET status = 'IN_SEWING', sewing_started_by = ${user.id}, sewing_started_at = now(), updated_at = now()
      WHERE id = ${id} AND status = 'VERIFIED'`;
    if (changed !== 1) throw errors.conflict("This batch is no longer waiting for sewing");
  });

  // Read after the commit, so the transaction (and the row lock) stays short.
  const detail = await readAfterCommit(() => loadSewingDetail(prisma, id));
  if (!detail) throw errors.internal();
  return detail;
}
