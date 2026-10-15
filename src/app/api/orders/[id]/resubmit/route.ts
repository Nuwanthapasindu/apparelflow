import { readOptionalJsonBody } from "@/lib/api/body";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { requireRole } from "@/lib/auth/session";
import { resubmitOrder } from "@/lib/services/verification";
import { emptyActionSchema, orderActionParamsSchema } from "@/lib/validation/verification";

export const POST = handle<RouteContext<"/api/orders/[id]/resubmit">>(
  async (request, context) => {
    const user = await requireRole(request, "cutting_supervisor");
    const { id } = parseWith(orderActionParamsSchema, await context.params);
    parseWith(emptyActionSchema, await readOptionalJsonBody(request));
    return ok({ order: await resubmitOrder(user, id) });
  },
  { mutating: true },
);
