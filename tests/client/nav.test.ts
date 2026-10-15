import { describe, expect, it } from "vitest";
import { LANDING, NAV, ROLE_LABEL, safeNext } from "@/lib/nav";

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
