import { describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { hashPassword, PASSWORD_HASH_OPTIONS, verifyPassword } from "@/lib/auth/password-hash";
import { makeUser } from "../helpers/auth";
import { prisma } from "../helpers/db";

// A genuine bcrypt (cost 10) hash of "Passw0rd-for-tests", the format the previous version of the app stored.
const LEGACY_BCRYPT = "$2b$10$9zC2FuTBOdmsjzznTkCZwOvUda5g1.RBRpprN66Z4sO9xgOER0CW2";

describe("password hashing (Argon2id)", () => {
  it("uses Argon2id at the OWASP minimum parameters and embeds them in the hash", async () => {
    expect(PASSWORD_HASH_OPTIONS).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const hash = await hashPassword("Correct-Horse-1");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(hash).not.toContain("Correct-Horse-1");
  });

  it("verifies the right password and rejects wrong ones", async () => {
    const hash = await hashPassword("Correct-Horse-1");
    expect(await verifyPassword(hash, "Correct-Horse-1")).toBe(true);
    for (const wrong of ["correct-horse-1", "Correct-Horse-1 ", " Correct-Horse-1", "Correct-Horse-2", "", "x".repeat(200)]) {
      expect(await verifyPassword(hash, wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("salts every hash, so equal passwords never produce equal hashes", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same-password-1")).toBe(true);
    expect(await verifyPassword(b, "same-password-1")).toBe(true);
  });

  it("handles unicode and very long passwords", async () => {
    const unicode = "pässwörd-密码-🔒-1";
    expect(await verifyPassword(await hashPassword(unicode, { memoryCost: 1024, timeCost: 1 }), unicode)).toBe(true);
    const long = "p".repeat(128);
    expect(await verifyPassword(await hashPassword(long, { memoryCost: 1024, timeCost: 1 }), long)).toBe(true);
  });

  it("verifies hashes made with other (cheaper or dearer) parameters, because they travel with the hash", async () => {
    const cheap = await hashPassword("pw-for-params-1", { memoryCost: 1024, timeCost: 1 });
    expect(cheap).toMatch(/m=1024,p=1,t=1/);
    expect(await verifyPassword(cheap, "pw-for-params-1")).toBe(true);
  });

  it.each([LEGACY_BCRYPT, "", "garbage", "$argon2id$", "$argon2id$v=19$m=1,t=1,p=1$bad$bad", "plaintext-password", "null"])(
    "treats the unreadable or legacy hash %j as a plain mismatch, never an exception",
    async (stored) => {
      await expect(verifyPassword(stored, "Passw0rd-for-tests")).resolves.toBe(false);
    },
  );
});

describe("login with the stored hash", () => {
  const login = (email: string, password: string) =>
    loginRoute(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        headers: { "content-type": "application/json" },
      }),
      undefined,
    );

  it("a user whose stored hash is an old bcrypt hash gets a clean 401 (re-run the seed to repair demo accounts)", async () => {
    const user = await makeUser("cutting_supervisor");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: LEGACY_BCRYPT } });
    const res = await login(user.email, user.password);
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe("Invalid email or password");
  });

  it("stores an Argon2id hash for new users and never the password", async () => {
    const user = await makeUser("cutting_verifier", { password: "Stored-Check-1" });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain("Stored-Check-1");
    expect((await login(user.email, "Stored-Check-1")).status).toBe(200);
    expect((await login(user.email, "Stored-Check-2")).status).toBe(401);
  });

  it("an unknown email and a wrong password still give the same 401 body", async () => {
    const user = await makeUser("cutting_supervisor");
    const [unknown, wrong] = await Promise.all([login("nobody@apparelflow.test", "x"), login(user.email, "wrong-password")]);
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });
});
