import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { BCRYPT_COST } from "./constants";
import type { AuthUser } from "./user";

// Created lazily and once, with the same cost as real hashes, so that an unknown email costs
// the same time as a known one and response timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("not-a-real-password", BCRYPT_COST));

/**
 * Check an email and password. Returns the user, or null for an unknown email, a wrong password
 * or an inactive user: the caller cannot tell which, by design.
 */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  const hash = user ? user.passwordHash : await getDummyHash();
  const matches = await bcrypt.compare(password, hash);
  if (!user || !matches || !user.isActive) return null;
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}
