import { handle } from "@/lib/api/handle";
import { ok } from "@/lib/api/response";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { clearedCookies, readCookie } from "@/lib/auth/cookies";
import { revokeSession } from "@/lib/auth/refresh";

// Idempotent: always 200 and always clears the cookies. Revokes the presented family, if any.
export const POST = handle(
  async (request) => {
    await revokeSession(readCookie(request, REFRESH_COOKIE));
    return ok({}, { cookies: clearedCookies() });
  },
  { mutating: true },
);
