import { describe, expect, it } from "vitest";
import { calculateWastage } from "@/lib/domain/wastage";
import { evaluateCount } from "@/lib/domain/traffic-light";
import { parseActualQtyText, rejectOrderSchema, saveCountsSchema } from "@/lib/validation/verification";

describe("traffic-light evaluation", () => {
  it("U1: maps exact, excess, shortage, zero and large counts", () => {
    expect(evaluateCount(10, 10)).toBe("GREEN");
    expect(evaluateCount(10, 11)).toBe("YELLOW");
    expect(evaluateCount(10, 9)).toBe("RED");
    expect(evaluateCount(10, 0)).toBe("RED");
    expect(evaluateCount(1, 1_000_000)).toBe("YELLOW");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10"])("U2: rejects invalid actual count %j", (actual) => {
    expect(() => evaluateCount(10, actual as number)).toThrow();
  });
});

describe("fabric wastage", () => {
  const project = (actualFabricYards: string, targetQty = 50, stdFabricYards = "1.80", wastageCapPct = "5.00") =>
    calculateWastage({ targetQty, stdFabricYards, actualFabricYards, wastageCapPct });

  it("U3: exactly at the cap is not over", () => {
    const result = project("94.50");
    expect(result.expectedFabricYards.toFixed(2)).toBe("90.00");
    expect(result.wastagePct.toFixed(2)).toBe("5.00");
    expect(result.overCap).toBe(false);
  });

  it("U4: rounds and flags a value over the cap", () => {
    const result = project("94.60");
    expect(result.wastagePct.toFixed(2)).toBe("5.11");
    expect(result.overCap).toBe(true);
  });

  it("U5: permits negative wastage", () => {
    const result = project("85.50");
    expect(result.wastagePct.toFixed(2)).toBe("-5.00");
    expect(result.overCap).toBe(false);
  });

  it("U6: rounds half up instead of half even", () => {
    const result = project("8.01", 1, "8.00", "5.00");
    expect(result.wastagePct.toFixed(2)).toBe("0.13");
  });

  it("U7: keeps extreme values exact in decimal arithmetic", () => {
    const result = project("999999.99", 1, "1.10", "8.00");
    expect(result.expectedFabricYards.toFixed(2)).toBe("1.10");
    expect(result.wastagePct.toFixed(2)).toBe("90908990.00");
    expect(result.overCap).toBe(true);
  });
});

describe("verification request validation", () => {
  it.each(["", " ", "\n\t", "x".repeat(1_001), "bad\u0000note", 5])("U8: rejects note %j", (note) => {
    expect(rejectOrderSchema.safeParse({ note }).success).toBe(false);
  });

  it("trims a valid rejection note", () => {
    expect(rejectOrderSchema.parse({ note: "  Sleeve seam damaged.  " })).toEqual({ note: "Sleeve seam damaged." });
  });

  it("rejects duplicate component ids", () => {
    const componentId = "00000000-0000-4000-8000-000000000001";
    expect(saveCountsSchema.safeParse({ counts: [{ componentId, actualQty: 1 }, { componentId, actualQty: 2 }] }).success).toBe(false);
  });

  it("uses the same whole-number count rule for live UI input", () => {
    expect(parseActualQtyText("0")).toEqual({ value: 0 });
    expect(parseActualQtyText("10000000")).toEqual({ value: 10_000_000 });
    for (const text of ["", "-1", "1.5", "1e3", "abc", "10000001"]) {
      expect(parseActualQtyText(text)).toEqual({ error: expect.any(String) });
    }
  });
});
