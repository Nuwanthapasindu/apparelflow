import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiFetch, refreshSession } from "@/lib/client/api";

type Reply = { status: number; body?: unknown; raw?: string };
const reply = ({ status, body, raw }: Reply) =>
  new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status });

let calls: { path: string; method: string }[];
const mockFetch = (handler: (path: string, n: number) => Reply | Promise<Reply> | Error) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? "GET" });
      const out = await handler(path, calls.length);
      if (out instanceof Error) throw out;
      return reply(out);
    }),
  );
};
const count = (path: string) => calls.filter((c) => c.path === path).length;

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("returns data from the success envelope", async () => {
    mockFetch(() => ({ status: 200, body: { data: { orders: [1] } } }));
    expect(await apiFetch("/api/orders")).toEqual({ orders: [1] });
  });

  it("sends JSON bodies and same-origin credentials", async () => {
    mockFetch(() => ({ status: 201, body: { data: {} } }));
    await apiFetch("/api/orders", { method: "POST", body: { a: 1 } });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"a":1}', headers: { "Content-Type": "application/json" } });
  });

  it("throws ApiClientError carrying status, code and per-field messages", async () => {
    mockFetch(() => ({ status: 400, body: { error: { code: "VALIDATION_ERROR", message: "bad", fields: { targetQty: "Enter a whole number" } } } }));
    await expect(apiFetch("/api/orders", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiClientError", status: 400, code: "VALIDATION_ERROR", fields: { targetQty: "Enter a whole number" },
    });
  });

  it("copes with a non-JSON error body (for example a proxy page)", async () => {
    mockFetch(() => ({ status: 502, raw: "<html>Bad gateway</html>" }));
    const error = await apiFetch("/api/orders").catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 502, code: "INTERNAL" });
  });

  it("on a 401 refreshes once with a POST, then retries once", async () => {
    mockFetch((path, n) => {
      if (path === "/api/auth/refresh") return { status: 200, body: { data: { user: {} } } };
      return n === 1 ? { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } } : { status: 200, body: { data: "ok" } };
    });
    expect(await apiFetch("/api/orders")).toBe("ok");
    expect(calls).toEqual([
      { path: "/api/orders", method: "GET" },
      { path: "/api/auth/refresh", method: "POST" },
      { path: "/api/orders", method: "GET" },
    ]);
  });

  it("gives up after one retry: a second 401 is surfaced and nothing loops", async () => {
    mockFetch((path) => (path === "/api/auth/refresh" ? { status: 200, body: { data: {} } } : { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } }));
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 401 });
    expect(count("/api/orders")).toBe(2);
    expect(count("/api/auth/refresh")).toBe(1);
  });

  it("does not retry when the refresh itself fails", async () => {
    mockFetch((path) => (path === "/api/auth/refresh" ? { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } } : { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } }));
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 401 });
    expect(count("/api/orders")).toBe(1);
  });

  it.each(["/api/auth/login", "/api/auth/logout", "/api/auth/refresh"])("never refreshes on a 401 from %s", async (path) => {
    mockFetch(() => ({ status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } } }));
    await expect(apiFetch(path, { method: "POST", body: {} })).rejects.toMatchObject({ status: 401, message: "Invalid email or password" });
    expect(count("/api/auth/refresh")).toBe(path === "/api/auth/refresh" ? 1 : 0);
  });

  it("does not refresh for errors other than 401", async () => {
    for (const status of [400, 403, 404, 409, 422, 500]) {
      mockFetch(() => ({ status, body: { error: { code: "X", message: "x" } } }));
      await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status });
      expect(count("/api/auth/refresh")).toBe(0);
    }
  });
});

describe("single-flight refresh", () => {
  it("five requests that all hit a 401 at once cause exactly one refresh, and each is retried", async () => {
    const seen = new Map<string, number>();
    mockFetch(async (path) => {
      if (path === "/api/auth/refresh") {
        await new Promise((r) => setTimeout(r, 20)); // slow enough for every caller to join
        return { status: 200, body: { data: {} } };
      }
      const n = (seen.get(path) ?? 0) + 1;
      seen.set(path, n);
      return n === 1 ? { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } } : { status: 200, body: { data: path } };
    });

    const results = await Promise.all(["/api/a", "/api/b", "/api/c", "/api/d", "/api/e"].map((p) => apiFetch(p)));
    expect(results).toEqual(["/api/a", "/api/b", "/api/c", "/api/d", "/api/e"]);
    expect(count("/api/auth/refresh")).toBe(1); // two refreshes would replay the token and kill the session family
  });

  it("concurrent callers share one in-flight refresh, and a later call starts a new one", async () => {
    mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { status: 200, body: { data: {} } };
    });
    expect(await Promise.all([refreshSession(), refreshSession(), refreshSession()])).toEqual([true, true, true]);
    expect(count("/api/auth/refresh")).toBe(1);
    await refreshSession();
    expect(count("/api/auth/refresh")).toBe(2);
  });

  it("a failed refresh resolves false (never throws) and does not wedge later attempts", async () => {
    mockFetch(() => new Error("network down"));
    expect(await refreshSession()).toBe(false);
    mockFetch(() => ({ status: 401, body: {} }));
    expect(await refreshSession()).toBe(false);
    mockFetch(() => ({ status: 200, body: { data: {} } }));
    expect(await refreshSession()).toBe(true);
  });

  it("always refreshes with POST, never GET", async () => {
    mockFetch(() => ({ status: 200, body: { data: {} } }));
    await refreshSession();
    expect(calls).toEqual([{ path: "/api/auth/refresh", method: "POST" }]);
  });
});
