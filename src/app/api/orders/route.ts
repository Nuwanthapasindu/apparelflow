import { handle } from "@/lib/api/handle";
import { readJsonBody } from "@/lib/api/body";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { requireRole } from "@/lib/auth/session";
import { createOrder, listOrders } from "@/lib/services/orders";
import { createOrderSchema } from "@/lib/validation/order";
import { parseListOrdersQuery } from "@/lib/validation/order-query";

// Order of checks: origin -> authenticate (401) -> role (403) -> validate (400) -> write.
export const POST = handle(
  async (request) => {
    const user = await requireRole(request, "cutting_supervisor");
    const input = parseWith(createOrderSchema, await readJsonBody(request));
    return ok({ order: await createOrder(user, input) }, { status: 201 });
  },
  { mutating: true },
);

export const GET = handle(async (request) => {
  const user = await requireRole(request, "cutting_supervisor", "cutting_verifier");
  const query = parseListOrdersQuery(new URL(request.url).searchParams);
  return ok(await listOrders(user, query));
});
