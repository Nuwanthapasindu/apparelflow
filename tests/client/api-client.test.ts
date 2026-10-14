import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClientError, apiClient, apiFetch, refreshSession } from "@/lib/client/api";

type Reply = { status: number; body?: unknown; raw?: string };

const originalAdapter = apiClient.defaults.adapter;
let calls: { path: string; method: string; data: unknown; contentType: unknown }[];

// Replace the axios adapter (the layer that would touch the network) with a scripted one.
const mockHttp = (handler: (path: string, n: number) => Reply | Promise<Reply> | Error) => {
  calls = [];
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({
      path: config.url ?? "",
      method: (config.method ?? "get").toUpperCase(),
      data: config.data,
      contentType: config.headers.get("Content-Type"),
    });
    const out = await handler(config.url ?? "", calls.length);
    if (out instanceof Error) throw out;
    return { data: out.raw ?? out.body, status: out.status, statusText: "", headers: {}, config };
  };
};
const count = (path: string) => calls.filter((c) => c.path === path).length;
const unauthorized = { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } };

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
});

describe("apiFetch", () => {
  it("returns data from the success envelope", async () => {
    mockHttp(() => ({ status: 200, body: { data: { orders: [1] } } }));
    expect(await apiFetch("/api/orders")).toEqual({ orders: [1] });
  });

  it("sends JSON bodies with the right method and content type", async () => {
    mockHttp(() => ({ status: 201, body: { data: {} } }));
    await apiFetch("/api/orders", { method: "POST", body: { a: 1 } });
    expect(calls[0]).toMatchObject({ path: "/api/orders", method: "POST", data: '{"a":1}' });
    expect(String(calls[0].contentType)).toContain("application/json");
  });

  it("sends no body for a plain GET", async () => {
    mockHttp(() => ({ status: 200, body: { data: 1 } }));
    await apiFetch("/api/me");
    expect(calls[0]).toMatchObject({ path: "/api/me", method: "GET", data: undefined });
  });

  it("throws ApiClientError carrying status, code and per-field messages", async () => {
    mockHttp(() => ({ status: 400, body: { error: { code: "VALIDATION_ERROR", message: "bad", fields: { targetQty: "Enter a whole number" } } } }));
    await expect(apiFetch("/api/orders", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiClientError", status: 400, code: "VALIDATION_ERROR", fields: { targetQty: "Enter a whole number" },
    });
  });

  it("copes with a non-JSON error body (for example a proxy page)", async () => {
    mockHttp(() => ({ status: 502, raw: "<html>Bad gateway</html>" }));
    const error = await apiFetch("/api/orders").catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 502, code: "INTERNAL" });
  });

  it("copes with an empty error body", async () => {
    mockHttp(() => ({ status: 500 }));
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 500, code: "INTERNAL" });
  });

  it("turns a network failure into an ApiClientError with status 0 (never a raw axios error)", async () => {
    mockHttp(() => new AxiosError("Network Error", AxiosError.ERR_NETWORK));
    const error = await apiFetch("/api/orders").catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK" });
  });

  it("turns a timeout into the same network error", async () => {
    mockHttp(() => new AxiosError("timeout of 30000ms exceeded", AxiosError.ECONNABORTED));
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 0, code: "NETWORK" });
  });

  it("has a request timeout and treats every status as a response to inspect", () => {
    expect(apiClient.defaults.timeout).toBe(30_000);
    expect(apiClient.defaults.validateStatus?.(500)).toBe(true);
  });

  it("on a 401 refreshes once with a POST, then retries once", async () => {
    mockHttp((path, n) => {
      if (path === "/api/auth/refresh") return { status: 200, body: { data: { user: {} } } };
      return n === 1 ? unauthorized : { status: 200, body: { data: "ok" } };
    });
    expect(await apiFetch("/api/orders")).toBe("ok");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/orders", "POST /api/auth/refresh", "GET /api/orders"]);
  });

  it("gives up after one retry: a second 401 is surfaced and nothing loops", async () => {
    mockHttp((path) => (path === "/api/auth/refresh" ? { status: 200, body: { data: {} } } : unauthorized));
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 401 });
    expect(count("/api/orders")).toBe(2);
    expect(count("/api/auth/refresh")).toBe(1);
  });

  it("does not retry when the refresh itself fails", async () => {
    mockHttp(() => unauthorized);
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 401 });
    expect(count("/api/orders")).toBe(1);
  });

  it("does not retry when the refresh call fails at the network level", async () => {
    mockHttp((path) => (path === "/api/auth/refresh" ? new AxiosError("Network Error", AxiosError.ERR_NETWORK) : unauthorized));
    await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status: 401 });
    expect(count("/api/orders")).toBe(1);
  });

  it.each(["/api/auth/login", "/api/auth/logout", "/api/auth/refresh"])("never refreshes on a 401 from %s", async (path) => {
    mockHttp(() => ({ status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } } }));
    await expect(apiFetch(path, { method: "POST", body: {} })).rejects.toMatchObject({ status: 401, message: "Invalid email or password" });
    expect(count("/api/auth/refresh")).toBe(path === "/api/auth/refresh" ? 1 : 0);
  });

  it("does not refresh for errors other than 401", async () => {
    for (const status of [400, 403, 404, 409, 422, 500]) {
      mockHttp(() => ({ status, body: { error: { code: "X", message: "x" } } }));
      await expect(apiFetch("/api/orders")).rejects.toMatchObject({ status });
      expect(count("/api/auth/refresh")).toBe(0);
    }
  });
});

describe("single-flight refresh", () => {
  it("five requests that all hit a 401 at once cause exactly one refresh, and each is retried", async () => {
    const seen = new Map<string, number>();
    mockHttp(async (path) => {
      if (path === "/api/auth/refresh") {
        await new Promise((r) => setTimeout(r, 20)); // slow enough for every caller to join
        return { status: 200, body: { data: {} } };
      }
      const n = (seen.get(path) ?? 0) + 1;
      seen.set(path, n);
      return n === 1 ? unauthorized : { status: 200, body: { data: path } };
    });

    const results = await Promise.all(["/api/a", "/api/b", "/api/c", "/api/d", "/api/e"].map((p) => apiFetch(p)));
    expect(results).toEqual(["/api/a", "/api/b", "/api/c", "/api/d", "/api/e"]);
    expect(count("/api/auth/refresh")).toBe(1); // two refreshes would replay the token and kill the session family
  });

  it("concurrent callers share one in-flight refresh, and a later call starts a new one", async () => {
    mockHttp(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { status: 200, body: { data: {} } };
    });
    expect(await Promise.all([refreshSession(), refreshSession(), refreshSession()])).toEqual([true, true, true]);
    expect(count("/api/auth/refresh")).toBe(1);
    await refreshSession();
    expect(count("/api/auth/refresh")).toBe(2);
  });

  it("a failed refresh resolves false (never throws) and does not wedge later attempts", async () => {
    mockHttp(() => new AxiosError("Network Error", AxiosError.ERR_NETWORK));
    expect(await refreshSession()).toBe(false);
    mockHttp(() => ({ status: 401, body: {} }));
    expect(await refreshSession()).toBe(false);
    mockHttp(() => ({ status: 200, body: { data: {} } }));
    expect(await refreshSession()).toBe(true);
  });

  it("always refreshes with POST, never GET", async () => {
    mockHttp(() => ({ status: 200, body: { data: {} } }));
    await refreshSession();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/auth/refresh"]);
  });
});
