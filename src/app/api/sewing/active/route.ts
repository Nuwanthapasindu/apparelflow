import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/session";
import { getSewingActive } from "@/lib/services/sewing";
import { parseSewingListQuery } from "@/lib/validation/sewing";

// Same order of checks as the queue. The IN_SEWING filter is a constant inside listSewingActive.
export const GET = handle(async (request) => {
  const user = await requireRole(request, "sewing_supervisor");
  const query = parseSewingListQuery(new URL(request.url).searchParams);
  return ok({ orders: await getSewingActive(user, query) });
});
