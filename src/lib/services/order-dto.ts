// Response shapes and mappers. Pure and import-safe for client components (types only).
// Prisma queries use explicit `select`s, so password hashes and token fields cannot leak in.
import type { ItemStatus, OrderStatus } from "@/generated/prisma/enums";

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
};

export type OrderDetailDto = OrderListItemDto & { items: OrderItemDto[] };

type Decimalish = { toFixed(places: number): string };

export type OrderRow = {
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

export function toOrderListItem(row: OrderRow): OrderListItemDto {
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

export function toOrderDetail(row: OrderRow, items: OrderItemDto[]): OrderDetailDto {
  return { ...toOrderListItem(row), items };
}
