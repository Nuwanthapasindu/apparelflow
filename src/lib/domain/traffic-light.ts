import type { ItemStatus } from "@/generated/prisma/enums";

/**
 * Compare a verifier's piece count with the immutable expected snapshot.
 * Invalid values are rejected instead of being coerced into a traffic-light state.
 */
export function evaluateCount(expected: number, actual: number): ItemStatus {
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new RangeError("Expected quantity must be a positive integer");
  }
  if (!Number.isInteger(actual) || actual < 0 || !Number.isFinite(actual)) {
    throw new RangeError("Actual quantity must be a non-negative integer");
  }
  if (actual === expected) return "GREEN";
  return actual > expected ? "YELLOW" : "RED";
}
