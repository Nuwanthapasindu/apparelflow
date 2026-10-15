import { errors } from "@/lib/api/errors";
import type { AuthUser } from "@/lib/auth/user";
import { prisma } from "@/lib/db";
import { MAX_LIMIT } from "@/lib/validation/order-query";
import type { SewingListQuery } from "@/lib/validation/sewing";
import { isOrderId } from "@/lib/validation/order";
import { SEWING_ORDER_SELECT, type SewingCardDto, type SewingDetailDto, toSewingCard, toSewingDetail } from "./sewing-dto";
import { listSewingQueue } from "./sewing-queue";

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

/**
 * One order for the sewing role. Scope is part of the query: only VERIFIED or IN_SEWING orders are
 * found, so a pending, rejected or unknown id is simply null and the caller answers 404, never
 * revealing that the order exists. Only the approved attempt's data is loaded.
 */
export async function getSewingOrder(user: AuthUser, id: string): Promise<SewingDetailDto | null> {
  assertSewing(user);
  if (!isOrderId(id)) return null; // ids are UUIDs: anything else cannot exist (and a NUL byte would break Postgres)

  const row = await prisma.cuttingOrder.findFirst({
    where: { id, status: { in: ["VERIFIED", "IN_SEWING"] } },
    select: SEWING_ORDER_SELECT,
  });
  if (!row) return null;
  const approved = row.logs.find((log) => log.attemptNo === row.currentAttempt);
  if (!approved) return null;

  const items = await prisma.verificationItem.findMany({
    where: { orderId: id, attemptNo: approved.attemptNo },
    orderBy: { componentName: "asc" },
    select: { componentName: true, expectedQty: true, actualQty: true, status: true },
  });
  return toSewingDetail(row, items);
}
