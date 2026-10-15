import { errors } from "@/lib/api/errors";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/session";
import { getSewingOrder } from "@/lib/services/sewing";

// Role first (403), scope second (404): a wrong role never learns whether an id exists, and the
// sewing role cannot tell a pending or rejected order from one that does not exist.
export const GET = handle<RouteContext<"/api/sewing/[id]">>(async (request, context) => {
  const user = await requireRole(request, "sewing_supervisor");
  const { id } = await context.params;
  const order = await getSewingOrder(user, id);
  if (!order) throw errors.notFound("Order not found");
  return ok({ order });
});
