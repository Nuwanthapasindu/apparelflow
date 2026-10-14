import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readJsonBody } from "@/lib/api/body";
import { ApiError, errors } from "@/lib/api/errors";
import { handle } from "@/lib/api/handle";
import { assertSameOrigin } from "@/lib/api/origin";
import { errorResponse, ok } from "@/lib/api/response";
import { parseWith } from "@/lib/api/validate";
import { mapDbError, sqlStateOf } from "@/lib/db-errors";

const req = (init: RequestInit & { url?: string } = {}) =>
  new Request(init.url ?? "http://localhost:3000/api/x", { method: "POST", ...init });

describe("response envelope", () => {
  it("wraps success in { data } and forbids caching", async () => {
    const res = ok({ a: 1 }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ data: { a: 1 } });
  });

  it("wraps errors in { error: { code, message, fields? } } and omits empty fields", async () => {
    const res = errorResponse(errors.validation({ targetQty: "Required" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "The request is not valid", fields: { targetQty: "Required" } },
    });
    expect(await errorResponse(errors.notFound()).json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  it("sends every cookie as its own Set-Cookie header", () => {
    const res = ok({}, { cookies: ["a=1; Path=/", "b=2; Path=/"] });
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    const err = errorResponse(errors.unauthenticated().withCookies(["a=; Max-Age=0"]));
    expect(err.headers.getSetCookie()).toEqual(["a=; Max-Age=0"]);
  });

  it.each([
    [errors.unauthenticated(), 401, "UNAUTHENTICATED"],
    [errors.forbidden(), 403, "FORBIDDEN"],
    [errors.csrfOrigin(), 403, "CSRF_ORIGIN"],
    [errors.validation(), 400, "VALIDATION_ERROR"],
    [errors.notFound(), 404, "NOT_FOUND"],
    [errors.conflict(), 409, "CONFLICT"],
    [errors.unprocessable(), 422, "UNPROCESSABLE"],
    [errors.internal(), 500, "INTERNAL"],
  ])("%s maps to the agreed status and code", (error, status, code) => {
    expect([error.status, error.code]).toEqual([status, code]);
  });
});

describe("handle()", () => {
  it("turns a thrown ApiError into the envelope", async () => {
    const res = await handle(async () => {
      throw errors.forbidden();
    })(req(), undefined);
    expect(res.status).toBe(403);
  });

  it("hides the details of unknown errors behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(async () => {
      throw new Error("SELECT * FROM users WHERE password_hash = 'secret-sql'");
    })(req(), undefined);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error).toEqual({ code: "INTERNAL", message: "Something went wrong" });
    expect(text).not.toContain("secret-sql");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-sql");
    spy.mockRestore();
  });

  it("maps leaked database errors to clean statuses without SQL text", async () => {
    const leaked = (code: string, message: string) => ({ code: "P2010", meta: { code, message: `ERROR: ${message}` } });
    for (const [state, status] of [["GK403", 403], ["GK409", 409], ["GK422", 422], ["23505", 409], ["23514", 400]] as const) {
      const res = await handle(async () => {
        throw leaked(state, "relation \"verification_logs\" violates something");
      })(req(), undefined);
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain("verification_logs");
    }
  });

  it("runs the Origin check before the handler when mutating", async () => {
    const inner = vi.fn(async () => ok({}));
    const wrapped = handle(inner, { mutating: true });
    const res = await wrapped(req({ headers: { origin: "https://evil.example" } }), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_ORIGIN");
    expect(inner).not.toHaveBeenCalled();

    expect((await wrapped(req(), undefined)).status).toBe(200); // no Origin: curl/Postman
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("does not check Origin for non-mutating handlers", async () => {
    const res = await handle(async () => ok({}))(req({ headers: { origin: "https://evil.example" } }), undefined);
    expect(res.status).toBe(200);
  });
});

describe("assertSameOrigin", () => {
  const check = (origin: string | null, extra: Record<string, string> = {}) =>
    assertSameOrigin(req({ headers: { ...(origin === null ? {} : { origin }), ...extra } }));

  it("allows a missing Origin and a matching one", () => {
    expect(() => check(null)).not.toThrow();
    expect(() => check("http://localhost:3000")).not.toThrow();
  });

  it("compares against the Host header, so preview deployments work", () => {
    expect(() => check("https://app-git-x.vercel.app", { host: "app-git-x.vercel.app" })).not.toThrow();
  });

  it.each([
    "https://evil.example",
    "http://localhost:3001", // same host, different port
    "http://localhost.evil.example",
    "http://localhost:3000.evil.example",
    "null", // sandboxed iframes and some redirects
    "not a url",
    "",
  ])("rejects Origin %j", (origin) => {
    expect(() => check(origin)).toThrow(ApiError);
    try {
      check(origin);
    } catch (e) {
      expect((e as ApiError).code).toBe("CSRF_ORIGIN");
    }
  });
});

describe("readJsonBody", () => {
  const body = (text: string) => readJsonBody(req({ body: text, headers: { "content-type": "application/json" } }));

  it("returns a JSON object", async () => {
    expect(await body('{"a":1}')).toEqual({ a: 1 });
  });

  it.each([
    ["empty body", ""],
    ["whitespace only", "   "],
    ["invalid JSON", "{nope"],
    ["an array", "[1,2]"],
    ["null", "null"],
    ["a string", '"x"'],
    ["a number", "5"],
    ["a boolean", "true"],
    ["an oversized body", JSON.stringify({ pad: "x".repeat(20_000) })],
  ])("rejects %s with a 400", async (_label, text) => {
    await expect(body(text)).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  it("rejects a request with no body at all", async () => {
    await expect(readJsonBody(req())).rejects.toMatchObject({ status: 400 });
  });
});

describe("parseWith", () => {
  const schema = z.strictObject({ name: z.string().min(2), age: z.number().int() });

  it("returns parsed data", () => {
    expect(parseWith(schema, { name: "Al", age: 3 })).toEqual({ name: "Al", age: 3 });
  });

  it("maps issues to per-field messages, including unknown keys", () => {
    try {
      parseWith(schema, { name: "A", age: 1.5, status: "VERIFIED", createdBy: "x" });
      expect.unreachable();
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(400);
      expect(Object.keys(err.fields ?? {}).sort()).toEqual(["age", "createdBy", "name", "status"]);
      expect(err.fields?.status).toBe("Unknown field");
    }
  });
});

describe("database error mapping", () => {
  it("reads the SQLSTATE from raw-query errors in both shapes", () => {
    expect(sqlStateOf({ code: "P2010", meta: { code: "GK409" } })).toBe("GK409");
    expect(sqlStateOf({ message: "Raw query failed. Code: `GK422`. Message: `x`" })).toBe("GK422");
    expect(sqlStateOf({ meta: { code: "not-a-state" } })).toBeUndefined();
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf(new Error("boom"))).toBeUndefined();
  });

  it("maps the agreed SQLSTATEs and Prisma P2002, and ignores the rest", () => {
    const status = (e: unknown) => mapDbError(e)?.status;
    expect(status({ meta: { code: "GK403" } })).toBe(403);
    expect(status({ meta: { code: "GK409" } })).toBe(409);
    expect(status({ meta: { code: "GK422" } })).toBe(422);
    expect(status({ meta: { code: "23505" } })).toBe(409);
    expect(status({ code: "P2002" })).toBe(409);
    expect(status({ meta: { code: "23514" } })).toBe(400);
    expect(mapDbError({ meta: { code: "42501" } })).toBeNull();
    expect(mapDbError(new Error("x"))).toBeNull();
  });
});
