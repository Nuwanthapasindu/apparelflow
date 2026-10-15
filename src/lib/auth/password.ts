import { prisma } from "@/lib/db";
import { verifyPassword } from "./password-hash";
import type { AuthUser } from "./user";

/**
 * Check an email and password. Returns the user, or null for an unknown email, a wrong password
 * or an inactive user: the caller gets the same answer for all three.
 *
 * Known limitation: an unknown email returns immediately, while a known one pays for a password
 * hash verification, so response time can reveal which emails have accounts. This was a deliberate
 * choice (no dummy comparison); the mitigation path is a rate limiter.
 */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  const matches = await verifyPassword(user.passwordHash, password);
  if (!matches || !user.isActive) return null;
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}
