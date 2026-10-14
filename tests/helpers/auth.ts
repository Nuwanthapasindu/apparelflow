import { randomUUID } from "node:crypto";
import type { Role } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password-hash";
import { signAccessToken } from "@/lib/auth/tokens";
import { prisma } from "./db";

// Cheap parameters keep the suite fast. The parameters live inside each hash, so verification of
// these test hashes goes through exactly the same code as production hashes.
const TEST_HASH = { memoryCost: 1024, timeCost: 1 };

export const DEMO = {
  supervisor: { role: "cutting_supervisor", email: "cutting.supervisor@apparelflow.test", password: "Demo-Supervisor-1", fullName: "Cutting Supervisor" },
  verifier: { role: "cutting_verifier", email: "cutting.verifier@apparelflow.test", password: "Demo-Verifier-1", fullName: "Cutting Verifier" },
  sewing: { role: "sewing_supervisor", email: "sewing.supervisor@apparelflow.test", password: "Demo-Sewing-1", fullName: "Sewing Supervisor" },
} as const satisfies Record<string, { role: Role; email: string; password: string; fullName: string }>;

export type DemoKey = keyof typeof DEMO;

/** Insert the three demo users (same emails and passwords as the seed). */
export async function seedDemoUsers() {
  const users = {} as Record<DemoKey, { id: string; email: string; password: string }>;
  for (const key of Object.keys(DEMO) as DemoKey[]) {
    const d = DEMO[key];
    const user = await prisma.user.create({
      data: { email: d.email, passwordHash: await hashPassword(d.password, TEST_HASH), role: d.role, fullName: d.fullName },
    });
    users[key] = { id: user.id, email: d.email, password: d.password };
  }
  return users;
}

/** A throwaway user with a known password. */
export async function makeUser(role: Role, overrides: { isActive?: boolean; password?: string } = {}) {
  const password = overrides.password ?? "Passw0rd-for-tests";
  const user = await prisma.user.create({
    data: {
      email: `${role}-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: await hashPassword(password, TEST_HASH),
      role,
      fullName: `Test ${role}`,
      isActive: overrides.isActive ?? true,
    },
  });
  return { ...user, password };
}

export type ParsedCookie = { name: string; value: string; attrs: string[]; raw: string };

/** Parse the Set-Cookie headers of a response. */
export function setCookies(res: Response): Record<string, ParsedCookie> {
  const out: Record<string, ParsedCookie> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";").map((p) => p.trim());
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs, raw };
  }
  return out;
}

/** A Cookie request header from Set-Cookie headers (what a browser would send back). */
export function cookieHeader(res: Response, only?: string[]): string {
  return Object.values(setCookies(res))
    .filter((c) => c.value !== "" && (!only || only.includes(c.name)))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** A request authenticated as a user, without going through login. */
export async function authedRequest(userId: string, url: string, init: RequestInit = {}) {
  const token = await signAccessToken(userId);
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `af_access=${token}` } });
}
