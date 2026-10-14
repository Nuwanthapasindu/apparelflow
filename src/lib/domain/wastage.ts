import { Prisma } from "@/generated/prisma/client";

export type WastageInput = {
  targetQty: number;
  stdFabricYards: string | number | Prisma.Decimal;
  actualFabricYards: string | number | Prisma.Decimal;
  wastageCapPct: string | number | Prisma.Decimal;
};

export type WastageProjection = {
  expectedFabricYards: Prisma.Decimal;
  actualFabricYards: Prisma.Decimal;
  wastagePct: Prisma.Decimal;
  wastageCapPct: Prisma.Decimal;
  overCap: boolean;
};

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/** Decimal-only fabric projection. No global decimal.js configuration is changed. */
export function calculateWastage(input: WastageInput): WastageProjection {
  if (!Number.isInteger(input.targetQty) || input.targetQty <= 0) {
    throw new RangeError("Target quantity must be a positive integer");
  }

  const standard = new Prisma.Decimal(input.stdFabricYards);
  const actual = new Prisma.Decimal(input.actualFabricYards);
  const cap = new Prisma.Decimal(input.wastageCapPct);
  const expected = standard.mul(input.targetQty).toDecimalPlaces(2, HALF_UP);
  if (!expected.isFinite() || expected.lte(0)) {
    throw new RangeError("Expected fabric must be greater than zero");
  }

  const wastagePct = actual.sub(expected).div(expected).mul(100).toDecimalPlaces(2, HALF_UP);
  return {
    expectedFabricYards: expected,
    actualFabricYards: actual.toDecimalPlaces(2, HALF_UP),
    wastagePct,
    wastageCapPct: cap.toDecimalPlaces(2, HALF_UP),
    overCap: wastagePct.gt(cap),
  };
}
