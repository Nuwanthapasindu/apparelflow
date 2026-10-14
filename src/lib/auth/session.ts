import type { Role } from "@/generated/prisma/client";
import { errors } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { ACCESS_COOKIE } from "./constants";
import { readCookie } from "./cookies";
import { verifyAccessToken } from "./tokens";
import type { AuthUser } from "./user";

/** The user id in a valid access cookie, or null. Does not touch the database. */
export async function getSession(request: Request): Promise<{ userId: string } | null> {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token) return null;
  const userId = await verifyAccessToken(token);
  return userId ? { userId } : null;
}

/**
 * Authenticate (401). The user and role are re-read from the database on every request, so a
 * deleted, deactivated or re-roled user is reflected immediately: the token carries no role.
 */
export async function requireSession(request: Request): Promise<AuthUser> {
  const session = await getSession(request);
  if (!session) throw errors.unauthenticated();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw errors.unauthenticated();
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

/** Authenticate (401), then authorise (403). Call first in every route handler. */
export async function requireRole(request: Request, ...roles: Role[]): Promise<AuthUser> {
  const user = await requireSession(request);
  if (!roles.includes(user.role)) throw errors.forbidden();
  return user;
}
