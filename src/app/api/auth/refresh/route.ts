import { handle } from "@/lib/api/handle";
import { errors } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { clearedCookies, readCookie } from "@/lib/auth/cookies";
import { rotateSession } from "@/lib/auth/refresh";
import { toUserDto } from "@/lib/auth/user";

// POST only: a refresh rotates state, so it must never be reachable by a GET.
export const POST = handle(
  async (request) => {
    const token = readCookie(request, REFRESH_COOKIE);
    if (!token) throw errors.unauthenticated("Session expired").withCookies(clearedCookies());

    const session = await rotateSession(token);
    return ok({ user: toUserDto(session.user) }, { cookies: session.cookies });
  },
  { mutating: true },
);
