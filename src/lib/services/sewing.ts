import { errors } from "@/lib/api/errors";
import type { AuthUser } from "@/lib/auth/user";
import type { SewingListQuery } from "@/lib/validation/sewing";
import type { SewingCardDto } from "./sewing-dto";
import { listSewingQueue } from "./sewing-queue";

// Services take the authenticated user and re-assert the role, so a caller that forgets
// requireRole still fails. The route handlers and the server-rendered pages both come through here.
const assertSewing = (user: AuthUser) => {
  if (user.role !== "sewing_supervisor") throw errors.forbidden();
};

export async function getSewingQueue(user: AuthUser, query: SewingListQuery): Promise<SewingCardDto[]> {
  assertSewing(user);
  return listSewingQueue(query);
}
