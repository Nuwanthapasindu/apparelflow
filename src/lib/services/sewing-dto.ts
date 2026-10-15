// Sewing response shapes and mappers. Selects are explicit and never include rejection notes, user
// ids, emails or earlier attempts: the sewing role only ever sees the approved attempt.
import type { Prisma } from "@/generated/prisma/client";
import type { ItemStatus } from "@/generated/prisma/enums";

export type SewingApprovalDto = {
  verifier: { fullName: string };
  decidedAt: string;
  wastagePct: string;
  wastageCapPct: string;
  overCap: boolean;
};

export type SewingCardDto = {
  id: string;
  orderNo: string;
  status: "VERIFIED" | "IN_SEWING";
  targetQty: number;
  fabricRollId: string;
  recipe: { recipeCode: string; name: string; category: string };
  /** The approved attempt: 1 for a first-time pass, 2 or more after a re-cut. */
  attemptNo: number;
  approval: SewingApprovalDto;
  sewingStartedBy?: { fullName: string };
  sewingStartedAt?: string;
};

export type SewingDetailDto = Omit<SewingCardDto, "approval"> & {
  approval: SewingApprovalDto & { expectedFabricYds: string; actualFabricYds: string };
  items: { componentName: string; expectedQty: number; actualQty: number; status: ItemStatus; variance: number }[];
};

export const SEWING_ORDER_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  targetQty: true,
  fabricRollId: true,
  currentAttempt: true,
  sewingStartedAt: true,
  recipe: { select: { recipeCode: true, name: true, category: true } },
  sewingStarter: { select: { fullName: true } },
  // Only APPROVED logs are ever loaded, so a rejection note cannot reach this layer.
  logs: {
    where: { decision: "APPROVED" as const },
    select: {
      attemptNo: true,
      decidedAt: true,
      expectedFabricYds: true,
      actualFabricYds: true,
      wastagePct: true,
      wastageCapPct: true,
      overCap: true,
      verifier: { select: { fullName: true } },
    },
  },
} as const satisfies Prisma.CuttingOrderSelect;

type Decimalish = { toFixed(places: number): string };

export type SewingOrderRow = {
  id: string;
  orderNo: string;
  status: string;
  targetQty: number;
  fabricRollId: string;
  currentAttempt: number;
  sewingStartedAt: Date | null;
  recipe: { recipeCode: string; name: string; category: string };
  sewingStarter: { fullName: string } | null;
  logs: {
    attemptNo: number;
    decidedAt: Date;
    expectedFabricYds: Decimalish | null;
    actualFabricYds: Decimalish | null;
    wastagePct: Decimalish | null;
    wastageCapPct: Decimalish | null;
    overCap: boolean | null;
    verifier: { fullName: string };
  }[];
};

/** The approval of the order's current attempt, or null when the snapshot is not complete. */
export function approvedSnapshot(row: SewingOrderRow) {
  const log = row.logs.find((l) => l.attemptNo === row.currentAttempt);
  if (!log || !log.expectedFabricYds || !log.actualFabricYds || !log.wastagePct || !log.wastageCapPct || log.overCap === null) {
    return null;
  }
  return {
    attemptNo: log.attemptNo,
    verifier: { fullName: log.verifier.fullName },
    decidedAt: log.decidedAt.toISOString(),
    wastagePct: log.wastagePct.toFixed(2),
    wastageCapPct: log.wastageCapPct.toFixed(2),
    overCap: log.overCap,
    expectedFabricYds: log.expectedFabricYds.toFixed(2),
    actualFabricYds: log.actualFabricYds.toFixed(2),
  };
}

/** Null (so the order is left out) unless it is VERIFIED or IN_SEWING with a complete approval. */
export function toSewingCard(row: SewingOrderRow): SewingCardDto | null {
  if (row.status !== "VERIFIED" && row.status !== "IN_SEWING") return null;
  const snapshot = approvedSnapshot(row);
  if (!snapshot) return null;
  return {
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    targetQty: row.targetQty,
    fabricRollId: row.fabricRollId,
    recipe: { recipeCode: row.recipe.recipeCode, name: row.recipe.name, category: row.recipe.category },
    attemptNo: snapshot.attemptNo,
    approval: {
      verifier: snapshot.verifier,
      decidedAt: snapshot.decidedAt,
      wastagePct: snapshot.wastagePct,
      wastageCapPct: snapshot.wastageCapPct,
      overCap: snapshot.overCap,
    },
    ...(row.status === "IN_SEWING" && row.sewingStarter && row.sewingStartedAt
      ? { sewingStartedBy: { fullName: row.sewingStarter.fullName }, sewingStartedAt: row.sewingStartedAt.toISOString() }
      : {}),
  };
}

export type SewingItemRow = {
  componentName: string;
  expectedQty: number;
  actualQty: number | null;
  status: ItemStatus | null;
};

/**
 * The detail view: the card plus the approved attempt's counts and the full fabric snapshot. Null
 * (so the caller answers 404) if any count is missing, which the database already makes impossible.
 */
export function toSewingDetail(row: SewingOrderRow, items: SewingItemRow[]): SewingDetailDto | null {
  const card = toSewingCard(row);
  const snapshot = approvedSnapshot(row);
  if (!card || !snapshot || items.length === 0) return null;
  const counted: SewingDetailDto["items"] = [];
  for (const item of items) {
    if (item.actualQty === null || item.status === null) return null;
    counted.push({
      componentName: item.componentName,
      expectedQty: item.expectedQty,
      actualQty: item.actualQty,
      status: item.status,
      variance: item.actualQty - item.expectedQty,
    });
  }
  return {
    ...card,
    approval: { ...card.approval, expectedFabricYds: snapshot.expectedFabricYds, actualFabricYds: snapshot.actualFabricYds },
    items: counted,
  };
}
