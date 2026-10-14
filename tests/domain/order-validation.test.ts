import { describe, expect, it } from "vitest";
import {
  checkFabricRollId,
  checkFabricYds,
  checkRecipeId,
  checkTargetQty,
  createOrderSchema,
  normalizeFabricYds,
  parseTargetQtyText,
} from "@/lib/validation/order";
import { parseListOrdersQuery } from "@/lib/validation/order-query";

const valid = (check: (v: unknown) => string | null, v: unknown) => expect(check(v), `expected ${JSON.stringify(v)} valid`).toBeNull();
const invalid = (check: (v: unknown) => string | null, v: unknown) => expect(check(v), `expected ${JSON.stringify(v)} invalid`).toEqual(expect.any(String));

describe("target quantity (JSON number, integer, 1..100000)", () => {
  it.each([1, 2, 50, 99_999, 100_000, 1.0])("accepts %s", (v) => valid(checkTargetQty, v));
  it.each([0, -1, -0, 5.5, 100_001, 1e21, NaN, Infinity, -Infinity, "50", "1e3", "", " ", null, undefined, true, [], {}, 0.1 + 0.2])(
    "rejects %j",
    (v) => invalid(checkTargetQty, v),
  );
});

describe("target quantity typed in the form", () => {
  it("accepts digits and returns the number", () => {
    expect(parseTargetQtyText("50")).toEqual({ value: 50 });
    expect(parseTargetQtyText("100000")).toEqual({ value: 100000 });
    expect(parseTargetQtyText("007")).toEqual({ value: 7 }); // typed zeros are harmless, the number is what is sent
  });
  it.each(["", " ", "0", "-1", "5.5", "1e3", "abc", "5 0", " 50", "50 ", "100001", "+5", "٥", "1,000", "9999999"])("rejects %j", (text) => {
    expect(parseTargetQtyText(text)).toHaveProperty("error");
  });
});

describe("fabric yards", () => {
  it.each(["1", "12", "12.5", "12.50", "0.01", "0.5", "10", "100", "999999.99", "999999", 12.5, 12, 0.5, 999999.99])("accepts %j", (v) => valid(checkFabricYds, v));
  it.each([
    0, "0", "0.0", "0.00", -1, "-1", "-0.5", "1e3", "1E3", "12.345", "12.", ".5", "abc", "", " ", null, undefined, "1,5", "007", "00", "01.5",
    "1000000", 1_000_000, "+5", "0x10", "Infinity", NaN, Infinity, " 12", "12 ", "1 2", true, [], {}, "１２", 1e21, 1e-7, 0.001, 0.1 + 0.2, "12\n", "12.5.1",
  ])("rejects %j", (v) => invalid(checkFabricYds, v));

  it("normalises to exactly two decimals without floating point", () => {
    expect(normalizeFabricYds("12")).toBe("12.00");
    expect(normalizeFabricYds("12.5")).toBe("12.50");
    expect(normalizeFabricYds("12.50")).toBe("12.50");
    expect(normalizeFabricYds("999999.99")).toBe("999999.99");
    expect(normalizeFabricYds("0.1")).toBe("0.10");
  });
});

describe("fabric roll id", () => {
  it.each(["FAB-ROLL-882", "A1b", "a.b_c-d", "  FAB-ROLL-882  ", "x".repeat(40), "1AB", "R_1"])("accepts %j", (v) => valid(checkFabricRollId, v));
  it.each(["", " ", "AB", "  AB  ", "x".repeat(41), "FAB ROLL", "-X1", ".X1", "_X1", "<script>", "FAB/1", "FAB\n1", "ΑΒΓ", "FÄB-1", "FAB'1", 123, null, undefined, [], {}])(
    "rejects %j",
    (v) => invalid(checkFabricRollId, v),
  );
});

describe("recipe id", () => {
  it.each(["a", "x".repeat(64)])("accepts %j", (v) => valid(checkRecipeId, v));
  it.each(["", "x".repeat(65), 1, null, undefined, {}])("rejects %j", (v) => invalid(checkRecipeId, v));
});

describe("create order schema", () => {
  const body = { recipeId: "r", targetQty: 50, fabricRollId: " FAB-1 ", actualFabricYds: 12.5 };

  it("returns the server's own normalised values", () => {
    expect(createOrderSchema.parse(body)).toEqual({ recipeId: "r", targetQty: 50, fabricRollId: "FAB-1", actualFabricYds: "12.50" });
  });

  it.each(["status", "createdBy", "createdById", "currentAttempt", "orderNo", "id", "createdAt", "sewingStartedById"])(
    "rejects the server-controlled field %s",
    (key) => {
      expect(createOrderSchema.safeParse({ ...body, [key]: "VERIFIED" }).success).toBe(false);
    },
  );

  it.each(["recipeId", "targetQty", "fabricRollId", "actualFabricYds"])("rejects a body missing %s", (key) => {
    const rest: Record<string, unknown> = { ...body };
    delete rest[key];
    expect(createOrderSchema.safeParse(rest).success).toBe(false);
  });
});

describe("list orders query", () => {
  const q = (s: string) => parseListOrdersQuery(new URLSearchParams(s));
  it("applies defaults and accepts valid values", () => {
    expect(q("")).toEqual({ limit: 50 });
    expect(q("limit=1&status=VERIFIED")).toEqual({ limit: 1, status: "VERIFIED" });
    expect(q("limit=100")).toEqual({ limit: 100 });
    expect(q("unknown=1")).toEqual({ limit: 50 });
  });
  it.each(["limit=0", "limit=101", "limit=abc", "limit=5.5", "limit=", "limit=-1", "limit=1e1", "limit=010", "limit=1&limit=2", "limit=%20", "limit=99999999999"])(
    "rejects %s",
    (s) => expect(() => q(s)).toThrow(expect.objectContaining({ status: 400, fields: expect.objectContaining({ limit: expect.any(String) }) })),
  );
  it.each(["status=bogus", "status=verified", "status=", "status=VERIFIED&status=REJECTED", "status=VERIFIED%20", "status='%20OR%201=1"])(
    "rejects %s",
    (s) => expect(() => q(s)).toThrow(expect.objectContaining({ status: 400, fields: expect.objectContaining({ status: expect.any(String) }) })),
  );
});
