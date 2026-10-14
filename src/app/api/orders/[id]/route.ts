import { errors } from "@/lib/api/errors";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/session";
import { getOrder } from "@/lib/services/orders";

// The role check comes before the lookup, so a wrong role gets 403 and never learns whether an id exists.
export const GET = handle<RouteContext<"/api/orders/[id]">>(async (request, context) => {
  const user = await requireRole(request, "cutting_supervisor");
  const { id } = await context.params;
  const order = await getOrder(user, id);
  if (!order) throw errors.notFound("Order not found");
  return ok({ order });
});
