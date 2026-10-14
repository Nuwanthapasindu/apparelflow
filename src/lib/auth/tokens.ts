import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getJwtSecret } from "@/lib/env";
import { ACCESS_TTL_SECONDS, JWT_ISSUER } from "./constants";

// The secret is read per call (lazily). A missing secret throws, which surfaces as a 500
// rather than being swallowed into a 401 that would hide the misconfiguration.
const key = () => new TextEncoder().encode(getJwtSecret());

/** Access token: HS256, only sub / iat / exp / iss. No role or anything else is ever put in it. */
export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key());
}

/** The user id from a valid access token, or null for anything invalid, expired or forged. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  const secret = key();
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"], // rejects alg:none and any other algorithm
      issuer: JWT_ISSUER,
      requiredClaims: ["sub", "iat", "exp"],
    });
    return typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Opaque refresh token: 32 random bytes, base64url. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored; the raw token exists solely in the cookie. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
