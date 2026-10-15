import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/session";
import { getSewingQueue } from "@/lib/services/sewing";
import { parseSewingListQuery } from "@/lib/validation/sewing";

// Order of checks: authenticate (401) -> role (403) -> validate limit (400) -> read. The status filter
// is a constant inside listSewingQueue; the only query parameter that is read is `limit`.
export const GET = handle(async (request) => {
  const user = await requireRole(request, "sewing_supervisor");
  const query = parseSewingListQuery(new URL(request.url).searchParams);
  return ok({ orders: await getSewingQueue(user, query) });
});
