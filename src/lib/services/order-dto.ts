// Response shapes and mappers. Queries use explicit selects, so hashes and token data cannot leak.
import type { Decision, ItemStatus, OrderStatus } from "@/generated/prisma/enums";
import { calculateWastage } from "@/lib/domain/wastage";

export type RecipeDto = {
  id: string;
  recipeCode: string;
  name: string;
  category: string;
  stdFabricYards: string;
  wastageCap: string;
  components: { id: string; componentName: string; piecesPerGarment: number }[];
};

export type OrderListItemDto = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  currentAttempt: number;
  targetQty: number;
  fabricRollId: string;
  actualFabricYds: string;
  recipe: { id: string; recipeCode: string; name: string };
  createdBy: { id: string; fullName: string };
  createdAt: string;
};

export type OrderItemDto = {
  componentId: string;
  componentName: string;
  expectedQty: number;
  actualQty: number | null;
  status: ItemStatus | null;
  variance: number | null;
};

export type FabricSnapshotDto = {
  expectedFabricYds: string;
  actualFabricYds: string;
  wastagePct: string;
  wastageCapPct: string;
  overCap: boolean;
};

export type AttemptDecisionDto = {
  decision: Decision;
  verifier: { id: string; fullName: string };
  decidedAt: string;
  rejectionNote: string | null;
  snapshot: FabricSnapshotDto | null;
};

export type OrderAttemptDto = {
  attemptNo: number;
  items: OrderItemDto[];
  decision: AttemptDecisionDto | null;
};

export type OrderDetailDto = Omit<OrderListItemDto, "recipe"> & {
  recipe: Omit<RecipeDto, "components">;
  fabricProjection?: FabricSnapshotDto;
  attempts: OrderAttemptDto[];
  /** Current-attempt compatibility alias used by the Day 2 creation response. */
  items: OrderItemDto[];
};

type Decimalish = { toFixed(places: number): string };

export type OrderListRow = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  currentAttempt: number;
  targetQty: number;
  fabricRollId: string;
  actualFabricYds: Decimalish;
  createdAt: Date;
  recipe: { id: string; recipeCode: string; name: string };
  createdBy: { id: string; fullName: string };
};

export type OrderDetailRow = Omit<OrderListRow, "recipe"> & {
  recipe: {
    id: string;
    recipeCode: string;
    name: string;
    category: string;
    stdFabricYards: Decimalish;
    wastageCap: Decimalish;
  };
  items: {
    attemptNo: number;
    componentId: string;
    componentName: string;
    expectedQty: number;
    actualQty: number | null;
    status: ItemStatus | null;
  }[];
  logs: {
    attemptNo: number;
    decision: Decision;
    rejectionNote: string | null;
    expectedFabricYds: Decimalish | null;
    actualFabricYds: Decimalish | null;
    wastagePct: Decimalish | null;
    wastageCapPct: Decimalish | null;
    overCap: boolean | null;
    decidedAt: Date;
    verifier: { id: string; fullName: string };
  }[];
};

export function toOrderListItem(row: OrderListRow): OrderListItemDto {
  return {
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    currentAttempt: row.currentAttempt,
    targetQty: row.targetQty,
    fabricRollId: row.fabricRollId,
    actualFabricYds: row.actualFabricYds.toFixed(2),
    recipe: { id: row.recipe.id, recipeCode: row.recipe.recipeCode, name: row.recipe.name },
    createdBy: { id: row.createdBy.id, fullName: row.createdBy.fullName },
    createdAt: row.createdAt.toISOString(),
  };
}

const toSnapshot = (log: OrderDetailRow["logs"][number]): FabricSnapshotDto | null => {
  if (
    log.decision !== "APPROVED" ||
    !log.expectedFabricYds ||
    !log.actualFabricYds ||
    !log.wastagePct ||
    !log.wastageCapPct ||
    log.overCap === null
  ) {
    return null;
  }
  return {
    expectedFabricYds: log.expectedFabricYds.toFixed(2),
    actualFabricYds: log.actualFabricYds.toFixed(2),
    wastagePct: log.wastagePct.toFixed(2),
    wastageCapPct: log.wastageCapPct.toFixed(2),
    overCap: log.overCap,
  };
};

export function toOrderDetail(row: OrderDetailRow): OrderDetailDto {
  const decisions = new Map(row.logs.map((log) => [log.attemptNo, log]));
  const attempts = new Map<number, OrderItemDto[]>();
  for (const item of row.items) {
    const items = attempts.get(item.attemptNo) ?? [];
    items.push({
      componentId: item.componentId,
      componentName: item.componentName,
      expectedQty: item.expectedQty,
      actualQty: item.actualQty,
      status: item.status,
      variance: item.actualQty === null ? null : item.actualQty - item.expectedQty,
    });
    attempts.set(item.attemptNo, items);
  }

  const base = toOrderListItem(row);
  const attemptDtos: OrderAttemptDto[] = [...attempts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([attemptNo, items]) => {
      const log = decisions.get(attemptNo);
      return {
        attemptNo,
        items,
        decision: log
          ? {
              decision: log.decision,
              verifier: { id: log.verifier.id, fullName: log.verifier.fullName },
              decidedAt: log.decidedAt.toISOString(),
              rejectionNote: log.rejectionNote,
              snapshot: toSnapshot(log),
            }
          : null,
      };
    });
  const detail: OrderDetailDto = {
    ...base,
    recipe: {
      id: row.recipe.id,
      recipeCode: row.recipe.recipeCode,
      name: row.recipe.name,
      category: row.recipe.category,
      stdFabricYards: row.recipe.stdFabricYards.toFixed(2),
      wastageCap: row.recipe.wastageCap.toFixed(2),
    },
    attempts: attemptDtos,
    items: attemptDtos.find((attempt) => attempt.attemptNo === row.currentAttempt)?.items ?? [],
  };

  if (row.status === "PENDING_VERIFICATION") {
    const projection = calculateWastage({
      targetQty: row.targetQty,
      stdFabricYards: row.recipe.stdFabricYards.toFixed(2),
      actualFabricYards: row.actualFabricYds.toFixed(2),
      wastageCapPct: row.recipe.wastageCap.toFixed(2),
    });
    detail.fabricProjection = {
      expectedFabricYds: projection.expectedFabricYards.toFixed(2),
      actualFabricYds: projection.actualFabricYards.toFixed(2),
      wastagePct: projection.wastagePct.toFixed(2),
      wastageCapPct: projection.wastageCapPct.toFixed(2),
      overCap: projection.overCap,
    };
  }
  return detail;
}
