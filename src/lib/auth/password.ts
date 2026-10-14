import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthUser } from "./user";

// A precomputed bcrypt hash (cost 10, same as real hashes, hash of a random throwaway string) that
// matches nothing. An unknown email is compared against it, so it costs the same as a known one
// and response time does not reveal which emails exist. It is a constant rather than created on
// first use: creating it lazily would make the first unknown-email request per server instance
// about twice as slow, leaking exactly that once.
const DUMMY_HASH = "$2b$10$usilhqYB1gYvegn7H88sx.059.sK48z1U4RxxcOvm8nSTkewFzztK";

/**
 * Check an email and password. Returns the user, or null for an unknown email, a wrong password
 * or an inactive user: the caller cannot tell which, by design.
 */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  const hash = user ? user.passwordHash : DUMMY_HASH;
  const matches = await bcrypt.compare(password, hash);
  if (!user || !matches || !user.isActive) return null;
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}
