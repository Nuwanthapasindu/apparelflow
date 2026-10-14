import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/session";
import { listRecipes } from "@/lib/services/orders";

export const GET = handle(async (request) => {
  const user = await requireRole(request, "cutting_supervisor");
  return ok({ recipes: await listRecipes(user) });
});
