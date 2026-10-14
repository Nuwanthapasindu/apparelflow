import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthUser } from "./user";

/**
 * Check an email and password. Returns the user, or null for an unknown email, a wrong password
 * or an inactive user: the caller gets the same answer for all three.
 *
 * Known limitation: an unknown email returns immediately, while a known one pays for a password
 * hash comparison, so response time can reveal which emails have accounts. This was a deliberate
 * choice (no dummy comparison); the mitigation path is a rate limiter.
 */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches || !user.isActive) return null;
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}
