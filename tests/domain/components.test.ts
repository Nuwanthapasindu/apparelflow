import { describe, expect, it } from "vitest";
import { expectedCounts, expectedQty } from "@/lib/domain/components";

describe("component multiplier", () => {
  it("is pieces per garment x garments in the batch", () => {
    expect(expectedQty(2, 50)).toBe(100); // 50 garments x 2 cuffs
    expect(expectedQty(1, 50)).toBe(50);
    expect(expectedQty(2, 20)).toBe(40);
  });

  it("handles the edges: one garment, the maximum batch, and zero", () => {
    expect(expectedQty(1, 1)).toBe(1);
    expect(expectedQty(2, 100_000)).toBe(200_000);
    expect(expectedQty(2, 0)).toBe(0);
  });

  it("keeps every other field of the component and does not mutate the input", () => {
    const components = [
      { componentName: "Sleeves", piecesPerGarment: 2 },
      { componentName: "Collar", piecesPerGarment: 1 },
    ];
    const result = expectedCounts(components, 50);
    expect(result).toEqual([
      { componentName: "Sleeves", piecesPerGarment: 2, expectedQty: 100 },
      { componentName: "Collar", piecesPerGarment: 1, expectedQty: 50 },
    ]);
    expect(components[0]).not.toHaveProperty("expectedQty");
    expect(expectedCounts([], 50)).toEqual([]);
  });
});
