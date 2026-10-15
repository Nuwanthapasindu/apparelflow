import { readOptionalJsonBody } from "@/lib/api/body";
import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { requireRole } from "@/lib/auth/session";
import { startSewing } from "@/lib/services/sewing";
import { emptyActionSchema, orderActionParamsSchema } from "@/lib/validation/verification";

// Order of checks: origin (CSRF) -> authenticate (401) -> role (403) -> id and body (400) -> lock and
// scope (404) -> state (409) -> write. The body must be empty: the starter and the time are server-owned.
export const POST = handle<RouteContext<"/api/sewing/[id]/start">>(
  async (request, context) => {
    const user = await requireRole(request, "sewing_supervisor");
    const { id } = parseWith(orderActionParamsSchema, await context.params);
    parseWith(emptyActionSchema, await readOptionalJsonBody(request));
    return ok({ order: await startSewing(user, id) });
  },
  { mutating: true },
);
