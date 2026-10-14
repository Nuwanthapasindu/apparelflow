import { afterEach, describe, expect, it, vi } from "vitest";
import { getDemoPersonas, isDemoMode } from "@/lib/demo";
import { LANDING, NAV, ROLE_LABEL, safeNext } from "@/lib/nav";
import { DEMO } from "../helpers/auth";

afterEach(() => vi.unstubAllEnvs());

describe("safeNext (no open redirects)", () => {
  it.each(["/", "/orders", "/orders/abc-123", "/verify?x=1", "/orders/%E2%9C%93"])("keeps the same-site path %j", (p) => {
    expect(safeNext(p)).toBe(p);
  });

  it.each([
    "//evil.com", "///evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "http://evil.com/orders", "javascript:alert(1)",
    "data:text/html,x", "evil.com", "orders", "", " /orders", "/orders\n/x", "/orders\r\nSet-Cookie: x=1", "/\u0000x", "/api/auth/logout", "/api/orders",
    "/" + "a".repeat(300),
  ])("falls back to / for %j", (p) => {
    expect(safeNext(p)).toBe("/");
  });

  it("falls back to / for null and undefined", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});

describe("role navigation", () => {
  it("each role sees exactly its own area and lands there", () => {
    expect(NAV.cutting_supervisor.map((i) => i.href)).toEqual(["/orders"]);
    expect(NAV.cutting_verifier.map((i) => i.href)).toEqual(["/verify"]);
    expect(NAV.sewing_supervisor.map((i) => i.href)).toEqual(["/sewing"]);
    for (const role of Object.keys(NAV) as (keyof typeof NAV)[]) {
      expect(NAV[role].map((i) => i.href)).toContain(LANDING[role]);
      expect(ROLE_LABEL[role]).toEqual(expect.any(String));
    }
  });

  it("no role is offered another role's page", () => {
    const all = Object.values(NAV).flat().map((i) => i.href);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("demo mode", () => {
  it("is off by default and exposes no credentials", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
    expect(isDemoMode()).toBe(false);
    expect(getDemoPersonas()).toEqual([]);
  });

  it.each(["false", "TRUE", "1", "yes", " true"])("is not enabled by %j (only the exact string true)", (v) => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", v);
    expect(getDemoPersonas()).toEqual([]);
  });

  it("when on, lists the three personas with the seeded demo credentials", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const personas = getDemoPersonas();
    expect(personas).toHaveLength(3);
    for (const p of personas) {
      const seeded = DEMO[p.key as keyof typeof DEMO];
      expect({ role: p.role, email: p.email, password: p.password }).toEqual({ role: seeded.role, email: seeded.email, password: seeded.password });
      expect(p.label).toBe(ROLE_LABEL[p.role]);
    }
  });
});
