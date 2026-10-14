import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as argon2 from "argon2";
import { GET as meRoute } from "@/app/api/me/route";
import * as loginModule from "@/app/api/auth/login/route";
import * as logoutModule from "@/app/api/auth/logout/route";
import * as refreshModule from "@/app/api/auth/refresh/route";
import { hashToken, signAccessToken } from "@/lib/auth/tokens";
import { cookieHeader, DEMO, makeUser, seedDemoUsers, setCookies, type DemoKey } from "../helpers/auth";
import { prisma } from "../helpers/db";

// Spy on argon2.verify without replacing it, to assert when a password check does and does not run.
vi.mock("argon2", async (importOriginal) => {
  const mod = await importOriginal<typeof import("argon2")>();
  return { ...mod, verify: vi.fn(mod.verify) };
});

const BASE = "http://localhost:3000";
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
const bare = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { method: "POST", headers });

const login = (email: string, password: string, headers?: Record<string, string>) =>
  loginModule.POST(json("/api/auth/login", { email, password }, headers), undefined);
const loginAs = (key: DemoKey, headers?: Record<string, string>) => login(DEMO[key].email, DEMO[key].password, headers);
const refresh = (cookie: string, headers: Record<string, string> = {}) =>
  refreshModule.POST(bare("/api/auth/refresh", { cookie, ...headers }), undefined);
const logout = (cookie?: string, headers: Record<string, string> = {}) =>
  logoutModule.POST(bare("/api/auth/logout", { ...(cookie ? { cookie } : {}), ...headers }), undefined);
const me = (cookie?: string) => meRoute(new Request(`${BASE}/api/me`, cookie ? { headers: { cookie } } : {}), undefined);

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!);
const refreshOf = (res: Response) => cookieHeader(res, ["af_refresh"]);
const rawRefresh = (res: Response) => setCookies(res).af_refresh.value;

beforeEach(async () => {
  await seedDemoUsers();
});
afterEach(() => vi.unstubAllEnvs());

describe("login", () => {
  it("A1: succeeds for each demo user, sets both cookies HttpOnly, and returns only the user", async () => {
    for (const key of Object.keys(DEMO) as DemoKey[]) {
      const res = await loginAs(key);
      expect(res.status).toBe(200);

      const cookies = setCookies(res);
      expect(Object.keys(cookies).sort()).toEqual(["af_access", "af_refresh"]);
      for (const c of Object.values(cookies)) expect(c.attrs).toContain("HttpOnly");

      const text = await res.clone().text();
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["data"]);
      expect(Object.keys(body.data)).toEqual(["user"]);
      expect(body.data.user).toEqual({ id: expect.any(String), email: DEMO[key].email, fullName: DEMO[key].fullName, role: DEMO[key].role });
      expect(text).not.toMatch(/token|hash|password/i);
      for (const c of Object.values(cookies)) expect(text).not.toContain(c.value);
    }
  });

  it("A2: wrong password, unknown email and inactive user give one identical 401", async () => {
    await prisma.user.update({ where: { email: DEMO.verifier.email }, data: { isActive: false } });
    const attempts = [
      await login(DEMO.supervisor.email, "wrong-password"),
      await login("nobody@apparelflow.test", "whatever-123"),
      await loginAs("verifier"),
    ];
    const bodies = await Promise.all(attempts.map((r) => r.json()));
    for (const r of attempts) {
      expect(r.status).toBe(401);
      expect(r.headers.getSetCookie()).toEqual([]);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({ error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } });
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it.each([
    ["missing email", { password: "x" }],
    ["missing password", { email: "a@b.c" }],
    ["empty body object", {}],
    ["non-string email", { email: 123, password: "x" }],
    ["non-string password", { email: "a@b.c", password: 123456 }],
    ["null email", { email: null, password: "x" }],
    ["array password", { email: "a@b.c", password: ["x"] }],
    ["object email", { email: { $ne: "" }, password: "x" }],
    ["empty email", { email: "", password: "x" }],
    ["blank email", { email: "   ", password: "x" }],
    ["empty password", { email: "a@b.c", password: "" }],
    ["129 character password", { email: "a@b.c", password: "p".repeat(129) }],
    ["255 character email", { email: `${"a".repeat(251)}@b.c`, password: "x" }],
    ["extra key", { email: "a@b.c", password: "x", role: "cutting_supervisor" }],
    ["extra key isAdmin", { email: "a@b.c", password: "x", isAdmin: true }],
  ])("A3: rejects %s with a 400", async (_label, body) => {
    const res = await loginModule.POST(json("/api/auth/login", body), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it.each(["", "not json", "[]", "null", '"str"', "42"])("A3: rejects the body %j with a 400", async (text) => {
    const res = await loginModule.POST(json("/api/auth/login", text), undefined);
    expect(res.status).toBe(400);
  });

  it("A3: the boundaries (128 character password, 254 character email) pass validation and simply fail to match", async () => {
    expect((await login(DEMO.supervisor.email, "p".repeat(128))).status).toBe(401);
    expect((await login(`${"a".repeat(250)}@b.c`, "x")).status).toBe(401);
  });

  it("trims and lowercases the email", async () => {
    expect((await login("  CUTTING.Supervisor@ApparelFlow.test  ", DEMO.supervisor.password)).status).toBe(200);
  });

  it("an injection-style email is just an unknown email", async () => {
    expect((await login("' OR 1=1 --", "x")).status).toBe(401);
    expect((await login("a@b.c'; DROP TABLE users; --", "x")).status).toBe(401);
    expect(await prisma.user.count()).toBe(3);
  });

  it("A4: stores only the SHA-256 hash of the refresh token", async () => {
    const raw = rawRefresh(await loginAs("supervisor"));
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(rows)).not.toContain(raw);
  });

  it("each login starts a new family", async () => {
    await loginAs("supervisor");
    await loginAs("supervisor");
    const families = new Set((await prisma.refreshToken.findMany()).map((r) => r.familyId));
    expect(families.size).toBe(2);
  });

  it("logging in while presenting a refresh cookie revokes the previous family", async () => {
    const first = await loginAs("supervisor");
    await loginAs("verifier", { cookie: refreshOf(first) });
    expect((await refresh(refreshOf(first))).status).toBe(401);
  });

  it("an unknown email is rejected without any password hashing; a known email is checked against its real hash", async () => {
    const verify = vi.mocked(argon2.verify);
    verify.mockClear();
    const unknown = await login("nobody@apparelflow.test", "whatever-123");
    expect(unknown.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();

    // Known email: the typed password is compared with that user's stored hash, nothing else.
    const stored = (await prisma.user.findUniqueOrThrow({ where: { email: DEMO.supervisor.email } })).passwordHash;
    await login(DEMO.supervisor.email, "wrong-password");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(stored, "wrong-password"); // the stored Argon2id hash first, then what was typed
  });

  it("a known but inactive user is still rejected (after the password check)", async () => {
    await prisma.user.update({ where: { email: DEMO.verifier.email }, data: { isActive: false } });
    expect((await loginAs("verifier")).status).toBe(401);
    expect((await loginAs("supervisor")).status).toBe(200);
  });
});

describe("GET /api/me and access tokens", () => {
  it("A5: returns the user with a valid cookie, 401 without one", async () => {
    const res = await me(cookieHeader(await loginAs("verifier"), ["af_access"]));
    expect(res.status).toBe(200);
    expect((await res.json()).data.user).toMatchObject({ email: DEMO.verifier.email, role: "cutting_verifier" });
    expect(res.headers.get("cache-control")).toBe("no-store");

    const none = await me();
    expect(none.status).toBe(401);
    expect((await none.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("A6: rejects a tampered signature, a wrong secret, alg:none and an expired token", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO.supervisor.email } });
    const good = await signAccessToken(user.id);
    const [h, p, s] = good.split(".");
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const sign = (key: Uint8Array, exp: number) =>
      new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuer("apparelflow").setIssuedAt(now - 2000).setExpirationTime(exp).sign(key);

    const bad = [
      `${h}.${p}.${s.slice(0, -3)}abc`,
      await sign(new TextEncoder().encode("y".repeat(48)), now + 900),
      `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user.id, iss: "apparelflow", iat: now, exp: now + 900 })}.`,
      await sign(secret(), now - 60),
    ];
    for (const token of bad) expect((await me(`af_access=${token}`)).status).toBe(401);
    expect((await me(`af_access=${good}`)).status).toBe(200);
  });

  it("A7: a token for a deleted or deactivated user stops working immediately", async () => {
    const gone = await makeUser("cutting_supervisor");
    const goneCookie = `af_access=${await signAccessToken(gone.id)}`;
    expect((await me(goneCookie)).status).toBe(200);
    await prisma.user.delete({ where: { id: gone.id } });
    expect((await me(goneCookie)).status).toBe(401);

    const cookie = cookieHeader(await loginAs("supervisor"), ["af_access"]);
    expect((await me(cookie)).status).toBe(200);
    await prisma.user.update({ where: { email: DEMO.supervisor.email }, data: { isActive: false } });
    expect((await me(cookie)).status).toBe(401);
  });

  it("A8: a role change applies on the very next request, because the token has no role", async () => {
    const cookie = cookieHeader(await loginAs("verifier"), ["af_access"]);
    expect((await (await me(cookie)).json()).data.user.role).toBe("cutting_verifier");
    await prisma.user.update({ where: { email: DEMO.verifier.email }, data: { role: "sewing_supervisor" } });
    expect((await (await me(cookie)).json()).data.user.role).toBe("sewing_supervisor");
  });

  it("only the allowed methods are exported", () => {
    expect(Object.keys(loginModule)).toEqual(["POST"]);
    expect(Object.keys(refreshModule)).toEqual(["POST"]); // a GET must never rotate state
    expect(Object.keys(logoutModule)).toEqual(["POST"]);
  });
});

describe("refresh rotation", () => {
  it("A9: rotates: new cookies, old token marked used, successor in the same family", async () => {
    const first = await loginAs("supervisor");
    const res = await refresh(refreshOf(first));
    expect(res.status).toBe(200);
    expect((await res.json()).data.user.email).toBe(DEMO.supervisor.email);

    const cookies = setCookies(res);
    expect(cookies.af_refresh.value).not.toBe(rawRefresh(first));
    expect(cookies.af_access.value).toBeTruthy();

    const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].usedAt).not.toBeNull();
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[1].usedAt).toBeNull();
    expect(rows[1].familyId).toBe(rows[0].familyId);
    expect(rows[1].tokenHash).toBe(hashToken(cookies.af_refresh.value));
    expect((await me(cookieHeader(res, ["af_access"]))).status).toBe(200);
  });

  it("can rotate several times in a row", async () => {
    let res = await loginAs("sewing");
    for (let i = 0; i < 4; i++) {
      res = await refresh(refreshOf(res));
      expect(res.status).toBe(200);
    }
  });

  it("A10: reusing an already-rotated token revokes the whole family, including the newest token", async () => {
    const first = await loginAs("supervisor");
    const second = await refresh(refreshOf(first));
    expect(second.status).toBe(200);

    const replay = await refresh(refreshOf(first));
    expect(replay.status).toBe(401);
    expect(Object.values(setCookies(replay)).every((c) => c.value === "" && c.attrs.includes("Max-Age=0"))).toBe(true);

    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect((await refresh(refreshOf(second))).status).toBe(401); // the newest token is dead too
  });

  it("A10: reuse revokes only that family, not the user's other sessions", async () => {
    const a = await loginAs("supervisor");
    const b = await loginAs("supervisor");
    await refresh(refreshOf(a));
    await refresh(refreshOf(a)); // replay on family A
    expect((await refresh(refreshOf(b))).status).toBe(200);
  });

  it("A11: expired, unknown and revoked tokens are all 401 and clear the cookies", async () => {
    const expired = await loginAs("supervisor");
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const unknown = "A".repeat(43);
    const revokedLogin = await loginAs("verifier");
    await prisma.refreshToken.updateMany({ where: { user: { email: DEMO.verifier.email } }, data: { revokedAt: new Date() } });

    for (const cookie of [refreshOf(expired), `af_refresh=${unknown}`, refreshOf(revokedLogin), "af_refresh=", `af_refresh=${"A".repeat(5000)}`, "af_refresh=%00%00"]) {
      const res = await refresh(cookie);
      expect(res.status).toBe(401);
      expect(setCookies(res).af_refresh.attrs).toContain("Max-Age=0");
    }
    const none = await refreshModule.POST(bare("/api/auth/refresh"), undefined);
    expect(none.status).toBe(401);
  });

  it("A12: two concurrent refreshes with the same token: one wins, one 401, family revoked", async () => {
    for (let round = 0; round < 3; round++) {
      const cookie = refreshOf(await loginAs("supervisor"));
      const results = await Promise.all([refresh(cookie), refresh(cookie)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);

      const winner = results.find((r) => r.status === 200)!;
      const familyId = (await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(cookie.split("=")[1]) } })).familyId;
      const rows = await prisma.refreshToken.findMany({ where: { familyId } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
      expect((await refresh(refreshOf(winner))).status).toBe(401);
    }
  });

  it("A12: many concurrent refreshes still produce exactly one success", async () => {
    const cookie = refreshOf(await loginAs("sewing"));
    const results = await Promise.all(Array.from({ length: 6 }, () => refresh(cookie)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
  });

  it("logout (or a new login) racing a refresh never leaves a live token in the family", async () => {
    // The refresh creates a successor token while logout revokes the family. Without serialising the
    // two, logout's UPDATE (snapshot taken before the successor existed) misses the new token.
    const survivors: number[] = [];
    for (let round = 0; round < 25; round++) {
      const first = await loginAs("supervisor");
      const familyId = (await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(rawRefresh(first)) } })).familyId;
      const cookie = refreshOf(first);
      const other = round % 2 === 0 ? () => logout(cookie) : () => loginAs("verifier", { cookie });
      await Promise.all([refresh(cookie), other()]);
      survivors.push(await prisma.refreshToken.count({ where: { familyId, revokedAt: null } }));
    }
    expect(survivors.filter((n) => n > 0)).toEqual([]);
  });

  it("A20: refresh is rejected for an inactive user and the family is revoked", async () => {
    const res = await loginAs("supervisor");
    await prisma.user.update({ where: { email: DEMO.supervisor.email }, data: { isActive: false } });
    expect((await refresh(refreshOf(res))).status).toBe(401);
    expect((await prisma.refreshToken.findMany()).every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("refresh ignores the request body and does not accept an access token in its place", async () => {
    const res = await loginAs("supervisor");
    const withBody = await refreshModule.POST(
      json("/api/auth/refresh", { role: "cutting_verifier", userId: "x" }, { cookie: refreshOf(res) }),
      undefined,
    );
    expect(withBody.status).toBe(200);
    expect((await withBody.json()).data.user.role).toBe("cutting_supervisor");

    const accessAsRefresh = `af_refresh=${setCookies(res).af_access.value}`;
    expect((await refresh(accessAsRefresh)).status).toBe(401);
  });

  it("a refresh token is not accepted as an access token", async () => {
    const res = await loginAs("supervisor");
    expect((await me(`af_access=${rawRefresh(res)}`)).status).toBe(401);
  });
});

describe("logout and role switching", () => {
  it("A13: clears the cookies, revokes the family, and the old refresh token stops working", async () => {
    const res = await loginAs("supervisor");
    const out = await logout(refreshOf(res));
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ data: {} });

    const cleared = setCookies(out);
    expect(cleared.af_access.raw).toBe("af_access=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    expect(cleared.af_refresh.raw).toBe("af_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax");

    expect((await prisma.refreshToken.findMany()).every((r) => r.revokedAt !== null)).toBe(true);
    expect((await refresh(refreshOf(res))).status).toBe(401);
  });

  it("A14: is idempotent: no cookies, unknown token, or a second logout all return 200", async () => {
    expect((await logout()).status).toBe(200);
    expect((await logout(`af_refresh=${"B".repeat(43)}`)).status).toBe(200);
    const res = await loginAs("supervisor");
    expect((await logout(refreshOf(res))).status).toBe(200);
    expect((await logout(refreshOf(res))).status).toBe(200);
  });

  it("A15: role switch (logout then login as another role) gives the new role and kills the old family", async () => {
    const asSupervisor = await loginAs("supervisor");
    await logout(refreshOf(asSupervisor));
    const asVerifier = await loginAs("verifier");

    const who = await me(cookieHeader(asVerifier, ["af_access"]));
    expect((await who.json()).data.user.role).toBe("cutting_verifier");
    expect((await refresh(refreshOf(asSupervisor))).status).toBe(401);
    expect((await refresh(refreshOf(asVerifier))).status).toBe(200);
  });
});

describe("CSRF and cookie attributes", () => {
  const evil = { origin: "https://evil.example" };

  it("A16: every mutating route rejects a foreign Origin with 403 CSRF_ORIGIN and does nothing", async () => {
    const session = await loginAs("supervisor");
    const rows = await prisma.refreshToken.count();

    const results = [
      await loginModule.POST(json("/api/auth/login", { email: DEMO.supervisor.email, password: DEMO.supervisor.password }, evil), undefined),
      await refresh(refreshOf(session), evil),
      await logout(refreshOf(session), evil),
    ];
    for (const res of results) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("CSRF_ORIGIN");
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(await prisma.refreshToken.count()).toBe(rows);
    expect((await prisma.refreshToken.findMany()).every((r) => r.revokedAt === null && r.usedAt === null)).toBe(true);
  });

  it("A16: the same requests succeed without an Origin header, or with a matching one", async () => {
    expect((await loginAs("supervisor")).status).toBe(200);
    expect((await loginAs("supervisor", { origin: BASE })).status).toBe(200);
    const res = await loginAs("supervisor");
    expect((await refresh(refreshOf(res), { origin: BASE })).status).toBe(200);
  });

  it("A16: the Origin check runs before validation, so a cross-site form post learns nothing", async () => {
    const res = await loginModule.POST(json("/api/auth/login", "garbage", evil), undefined);
    expect(res.status).toBe(403);
  });

  it("A17: the refresh cookie is scoped to /api/auth and the access cookie to /", async () => {
    for (const res of [await loginAs("supervisor"), await refresh(refreshOf(await loginAs("sewing")))]) {
      const cookies = setCookies(res);
      expect(cookies.af_refresh.attrs).toContain("Path=/api/auth");
      expect(cookies.af_access.attrs).toContain("Path=/");
      expect(cookies.af_refresh.attrs).toContain("Max-Age=604800");
      expect(cookies.af_access.attrs).toContain("Max-Age=900");
      expect(cookies.af_refresh.attrs).toContain("SameSite=Lax");
    }
  });

  it("A18: Secure is set in production and absent otherwise", async () => {
    expect((await loginAs("supervisor")).headers.getSetCookie().join()).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    const res = await loginAs("supervisor");
    for (const raw of res.headers.getSetCookie()) expect(raw).toMatch(/; Secure$/);
    for (const raw of (await logout()).headers.getSetCookie()) expect(raw).toMatch(/; Secure$/);
  });
});
