import { handle } from "@/lib/api/handle";
import { errors } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/api/body";
import { ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { readCookie } from "@/lib/auth/cookies";
import { authenticate } from "@/lib/auth/password";
import { revokeSession, startSession } from "@/lib/auth/refresh";
import { toUserDto } from "@/lib/auth/user";
import { loginSchema } from "@/lib/validation/auth";

// One message for every failure (unknown email, wrong password, inactive user).
const INVALID = "Invalid email or password";

export const POST = handle(
  async (request) => {
    const { email, password } = parseWith(loginSchema, await readJsonBody(request));

    const user = await authenticate(email, password);
    if (!user) throw errors.unauthenticated(INVALID);

    // A new login replaces this browser's session: do not leave the previous family alive.
    await revokeSession(readCookie(request, REFRESH_COOKIE));

    const session = await startSession(user);
    return ok({ user: toUserDto(session.user) }, { cookies: session.cookies });
  },
  { mutating: true },
);
