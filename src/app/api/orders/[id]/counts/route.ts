import { readJsonBody } from "@/lib/api/body";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { requireRole } from "@/lib/auth/session";
import { saveCounts } from "@/lib/services/verification";
import { orderActionParamsSchema, saveCountsSchema } from "@/lib/validation/verification";

export const PUT = handle<RouteContext<"/api/orders/[id]/counts">>(
  async (request, context) => {
    const user = await requireRole(request, "cutting_verifier");
    const { id } = parseWith(orderActionParamsSchema, await context.params);
    const input = parseWith(saveCountsSchema, await readJsonBody(request));
    return ok({ order: await saveCounts(user, id, input) });
  },
  { mutating: true },
);
