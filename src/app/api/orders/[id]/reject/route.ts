import { readJsonBody } from "@/lib/api/body";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { requireRole } from "@/lib/auth/session";
import { rejectOrder } from "@/lib/services/verification";
import { orderActionParamsSchema, rejectOrderSchema } from "@/lib/validation/verification";

export const POST = handle<RouteContext<"/api/orders/[id]/reject">>(
  async (request, context) => {
    const user = await requireRole(request, "cutting_verifier");
    const { id } = parseWith(orderActionParamsSchema, await context.params);
    const input = parseWith(rejectOrderSchema, await readJsonBody(request));
    return ok({ order: await rejectOrder(user, id, input) });
  },
  { mutating: true },
);
