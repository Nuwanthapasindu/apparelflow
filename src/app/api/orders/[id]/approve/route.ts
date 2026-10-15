import { readOptionalJsonBody } from "@/lib/api/body";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { requireRole } from "@/lib/auth/session";
import { approveOrder } from "@/lib/services/verification";
import { emptyActionSchema, orderActionParamsSchema } from "@/lib/validation/verification";

export const POST = handle<RouteContext<"/api/orders/[id]/approve">>(
  async (request, context) => {
    const user = await requireRole(request, "cutting_verifier");
    const { id } = parseWith(orderActionParamsSchema, await context.params);
    parseWith(emptyActionSchema, await readOptionalJsonBody(request));
    return ok({ order: await approveOrder(user, id) });
  },
  { mutating: true },
);
