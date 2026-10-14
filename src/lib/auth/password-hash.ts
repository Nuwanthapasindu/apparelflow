import { argon2id, hash, verify } from "argon2";

/**
 * Argon2id at the OWASP minimum recommendation (19 MiB, 2 passes, 1 lane). The parameters are
 * stored inside every hash, so they can be raised later without invalidating existing passwords.
 */
export const PASSWORD_HASH_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export type PasswordHashCost = { memoryCost?: number; timeCost?: number; parallelism?: number };

/** `cost` exists so tests can use cheap parameters; production callers pass nothing. */
export function hashPassword(password: string, cost: PasswordHashCost = {}): Promise<string> {
  return hash(password, { ...PASSWORD_HASH_OPTIONS, ...cost });
}

/** True only for a matching Argon2 hash. Anything unreadable (for example an old bcrypt hash) is a plain false. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
