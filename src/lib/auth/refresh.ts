import { randomUUID } from "node:crypto";
import { errors } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { REFRESH_TTL_SECONDS } from "./constants";
import { clearedCookies, sessionCookies } from "./cookies";
import { generateRefreshToken, hashToken, signAccessToken } from "./tokens";
import type { AuthUser } from "./user";

export type IssuedSession = { user: AuthUser; cookies: string[] };

const MAX_TOKEN_LENGTH = 200;
const refreshExpiry = () => new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
const unauthorized = () => errors.unauthenticated("Session expired").withCookies(clearedCookies());

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Rotation and revocation of one family must not interleave. Without this, a logout that starts
 * while a rotation is in flight takes its snapshot before the successor token exists, blocks on
 * the claimed row, and then never sees the successor: the user logs out but a live token remains.
 * A transaction-scoped advisory lock (released at commit, safe on the transaction pooler) makes
 * the second operation start only after the first has committed.
 */
const lockFamily = (tx: Tx, familyId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${familyId}))`;

const revokeFamily = (tx: Tx, familyId: string) =>
  tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });

const revokeFamilySerialised = (familyId: string) =>
  prisma.$transaction(async (tx) => {
    await lockFamily(tx, familyId);
    await revokeFamily(tx, familyId);
  });

/** Login: a brand new token family. */
export async function startSession(user: AuthUser): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, familyId: randomUUID(), tokenHash: hashToken(refreshToken), expiresAt: refreshExpiry() },
  });
  return { user, cookies: sessionCookies(await signAccessToken(user.id), refreshToken) };
}

/**
 * Rotate a refresh token. Race-safe: the token is claimed with a conditional UPDATE inside a
 * transaction, so of two concurrent requests with the same token exactly one wins. Presenting a
 * token that was already used revokes the whole family (reuse detection).
 */
export async function rotateSession(rawToken: string): Promise<IssuedSession> {
  if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) throw unauthorized();

  const tokenHash = hashToken(rawToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row || row.revokedAt || row.expiresAt <= new Date()) throw unauthorized();

  const outcome = await prisma.$transaction(async (tx) => {
    await lockFamily(tx, row.familyId);
    const user = await tx.user.findUnique({
      where: { id: row.userId },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      await revokeFamily(tx, row.familyId);
      return { kind: "denied" as const };
    }

    const claim = await tx.refreshToken.updateMany({
      where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) {
      await revokeFamily(tx, row.familyId); // already used: someone is replaying a stolen token
      return { kind: "denied" as const };
    }

    const next = generateRefreshToken();
    await tx.refreshToken.create({
      data: { userId: user.id, familyId: row.familyId, tokenHash: hashToken(next), expiresAt: refreshExpiry() },
    });
    return {
      kind: "ok" as const,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      next,
    };
  });

  if (outcome.kind === "denied") throw unauthorized();
  return { user: outcome.user, cookies: sessionCookies(await signAccessToken(outcome.user.id), outcome.next) };
}

/** Logout: revoke the family of the presented token. Idempotent; unknown tokens are ignored. */
export async function revokeSession(rawToken: string | null): Promise<void> {
  if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (row) await revokeFamilySerialised(row.familyId);
}
