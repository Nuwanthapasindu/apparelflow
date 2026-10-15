import { MAX_LIMIT } from "@/lib/validation/order-query";
import { prisma } from "@/lib/db";
import { SEWING_ORDER_SELECT, type SewingCardDto, toSewingCard } from "./sewing-dto";

/**
 * THE SEWING QUEUE QUERY. Invariant: only orders whose status is VERIFIED are ever returned.
 *
 * The status filter below is a constant. It is not a parameter, is never read from the request, and
 * is applied again when the rows are loaded. This one function serves GET /api/sewing/queue, the
 * server-rendered /sewing page and brief Test 5, so the query that is tested is the query that ships.
 *
 * Callers must authorise the sewing role first (the endpoint and the page both do). Oldest approval
 * first, then id. The join takes the approving log of the order's current attempt.
 */
export async function listSewingQueue({ limit }: { limit: number }): Promise<SewingCardDto[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError("limit out of range");

  const queued = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id
    FROM cutting_orders o
    JOIN verification_logs l
      ON l.order_id = o.id AND l.attempt_no = o.current_attempt AND l.decision = 'APPROVED'
    WHERE o.status = 'VERIFIED'
    ORDER BY l."timestamp" ASC, o.id ASC
    LIMIT ${limit}`;
  if (queued.length === 0) return [];

  const rows = await prisma.cuttingOrder.findMany({
    where: { id: { in: queued.map((q) => q.id) }, status: "VERIFIED" },
    select: SEWING_ORDER_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return queued.flatMap(({ id }) => {
    const row = byId.get(id);
    const card = row && toSewingCard(row);
    return card ? [card] : [];
  });
}
