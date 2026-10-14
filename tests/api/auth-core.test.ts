import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearedCookies, readCookie, sessionCookies } from "@/lib/auth/cookies";
import { requireRole, requireSession } from "@/lib/auth/session";
import { generateRefreshToken, hashToken, signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";
import { getJwtSecret } from "@/lib/env";
import { authedRequest, makeUser } from "../helpers/auth";
import { prisma } from "../helpers/db";

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

afterEach(() => vi.unstubAllEnvs());

describe("access token", () => {
  it("round-trips the user id and contains only sub, iss, iat and exp", async () => {
    const token = await signAccessToken("user-1");
    expect(await verifyAccessToken(token)).toBe("user-1");

    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "iss", "sub"]);
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.iss).toBe("apparelflow");
  });

  it("rejects a tampered signature or payload", async () => {
    const [h, p, s] = (await signAccessToken("user-1")).split(".");
    const forgedPayload = b64({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "someone-else" });
    expect(await verifyAccessToken(`${h}.${p}.${s.slice(0, -2)}xx`)).toBeNull();
    expect(await verifyAccessToken(`${h}.${forgedPayload}.${s}`)).toBeNull();
    expect(await verifyAccessToken(`${h}.${p}.`)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u").setIssuer("apparelflow")
      .setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode("x".repeat(40)));
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it("rejects alg:none, however it is dressed up", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = b64({ sub: "user-1", iss: "apparelflow", iat: now, exp: now + 900 });
    for (const alg of ["none", "None", "NONE"]) {
      expect(await verifyAccessToken(`${b64({ alg, typ: "JWT" })}.${payload}.`)).toBeNull();
    }
  });

  it("rejects other algorithms even when signed with the right secret", async () => {
    const hs512 = await new SignJWT({}).setProtectedHeader({ alg: "HS512" }).setSubject("u").setIssuer("apparelflow")
      .setIssuedAt().setExpirationTime("15m").sign(secret());
    expect(await verifyAccessToken(hs512)).toBeNull();
  });

  it("rejects expired tokens, wrong issuer, missing claims and garbage", async () => {
    const base = () => new SignJWT({}).setProtectedHeader({ alg: "HS256" });
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(await verifyAccessToken(await base().setSubject("u").setIssuer("apparelflow").setIssuedAt(past - 900).setExpirationTime(past).sign(secret()))).toBeNull();
    expect(await verifyAccessToken(await base().setSubject("u").setIssuer("someone-else").setIssuedAt().setExpirationTime("15m").sign(secret()))).toBeNull();
    expect(await verifyAccessToken(await base().setIssuer("apparelflow").setIssuedAt().setExpirationTime("15m").sign(secret()))).toBeNull(); // no sub
    expect(await verifyAccessToken(await base().setSubject("u").setIssuer("apparelflow").setIssuedAt().sign(secret()))).toBeNull(); // no exp: would never expire
    for (const junk of ["", "abc", "a.b", "a.b.c", "....", " "]) expect(await verifyAccessToken(junk)).toBeNull();
  });
});

describe("JWT_SECRET", () => {
  it("is read lazily and must be at least 32 characters", () => {
    vi.stubEnv("JWT_SECRET", "x".repeat(31));
    expect(() => getJwtSecret()).toThrow(/at least 32/);
    vi.stubEnv("JWT_SECRET", "");
    expect(() => getJwtSecret()).toThrow();
    vi.stubEnv("JWT_SECRET", "x".repeat(32));
    expect(getJwtSecret()).toHaveLength(32);
  });

  it("a missing secret is an error, not a silent 401", async () => {
    vi.stubEnv("JWT_SECRET", "");
    await expect(verifyAccessToken("a.b.c")).rejects.toThrow(/JWT_SECRET/);
    await expect(signAccessToken("u")).rejects.toThrow(/JWT_SECRET/);
  });
});

describe("refresh token", () => {
  it("is 32 random bytes, base64url, and unique", () => {
    const a = generateRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(a);
  });

  it("is hashed with SHA-256 (hex) for storage", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("abc")).not.toContain("abc");
  });
});

describe("cookies", () => {
  const parse = (c: string) => Object.fromEntries(c.split("; ").map((p) => p.split("=")));

  it("sets both cookies HttpOnly, SameSite=Lax, with the agreed paths and lifetimes", () => {
    const [access, refresh] = sessionCookies("AT", "RT");
    expect(access).toMatch(/^af_access=AT; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax$/);
    expect(refresh).toMatch(/^af_refresh=RT; Path=\/api\/auth; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    expect(parse(refresh).Path).toBe("/api/auth"); // A17: never sent to /api/orders etc.
  });

  it("adds Secure only in production", () => {
    expect(sessionCookies("a", "b").join()).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    for (const c of sessionCookies("a", "b")) expect(c).toMatch(/; Secure$/);
    for (const c of clearedCookies()) expect(c).toMatch(/; Secure$/);
  });

  it("clears with the same paths and Max-Age=0", () => {
    const [access, refresh] = clearedCookies();
    expect(access).toBe("af_access=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    expect(refresh).toBe("af_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax");
  });

  it("reads one cookie from the Cookie header", () => {
    const r = (cookie?: string) => new Request("http://x/", cookie ? { headers: { cookie } } : {});
    expect(readCookie(r("a=1; af_access=tok; b=2"), "af_access")).toBe("tok");
    expect(readCookie(r("af_access2=nope"), "af_access")).toBeNull();
    expect(readCookie(r("xaf_access=nope"), "af_access")).toBeNull();
    expect(readCookie(r("af_access=a=b=c"), "af_access")).toBe("a=b=c");
    expect(readCookie(r("af_access=first; af_access=second"), "af_access")).toBe("first");
    expect(readCookie(r("af_access="), "af_access")).toBeNull();
    expect(readCookie(r("garbage"), "af_access")).toBeNull();
    expect(readCookie(r(), "af_access")).toBeNull();
  });
});

describe("requireSession / requireRole (role is read from the database every time)", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  const call = async (userId: string) => authedRequest(userId, "http://localhost/api/x");

  it("returns the user for a valid token, without hashes", async () => {
    const u = await makeUser("cutting_supervisor");
    const user = await requireSession(await call(u.id));
    expect(user).toEqual({ id: u.id, email: u.email, fullName: u.fullName, role: "cutting_supervisor" });
  });

  it("401 without a cookie or with a bad one", async () => {
    await expect(requireSession(new Request("http://x/"))).rejects.toMatchObject({ status: 401 });
    await expect(requireSession(new Request("http://x/", { headers: { cookie: "af_access=junk" } }))).rejects.toMatchObject({ status: 401 });
  });

  it("401 for a deleted user and for a deactivated user", async () => {
    const gone = await makeUser("cutting_supervisor");
    const req = await call(gone.id);
    await prisma.user.delete({ where: { id: gone.id } });
    await expect(requireSession(req)).rejects.toMatchObject({ status: 401 });

    const off = await makeUser("cutting_supervisor");
    const req2 = await call(off.id);
    await prisma.user.update({ where: { id: off.id }, data: { isActive: false } });
    await expect(requireSession(req2)).rejects.toMatchObject({ status: 401 });
  });

  it("403 for the wrong role, and a role change applies to an already issued token", async () => {
    const u = await makeUser("cutting_verifier");
    const req = await call(u.id);
    await expect(requireRole(req, "cutting_supervisor")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(requireRole(req, "cutting_verifier")).resolves.toMatchObject({ role: "cutting_verifier" });

    await prisma.user.update({ where: { id: u.id }, data: { role: "cutting_supervisor" } });
    await expect(requireRole(req, "cutting_supervisor")).resolves.toMatchObject({ role: "cutting_supervisor" });
    await expect(requireRole(req, "cutting_verifier")).rejects.toMatchObject({ status: 403 });
  });

  it("authenticates before authorising: no session is 401, never 403", async () => {
    await expect(requireRole(new Request("http://x/"), "cutting_supervisor")).rejects.toMatchObject({ status: 401 });
  });
});
