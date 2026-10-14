import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { toUserDto } from "@/lib/auth/user";

export const GET = handle(async (request) => {
  const user = await requireSession(request);
  return ok({ user: toUserDto(user) });
});
