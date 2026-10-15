import { randomUUID } from "node:crypto";
import * as approveRoute from "@/app/api/orders/[id]/approve/route";
import * as countsRoute from "@/app/api/orders/[id]/counts/route";
import * as orderRoute from "@/app/api/orders/route";
import * as orderByIdRoute from "@/app/api/orders/[id]/route";
import * as rejectRoute from "@/app/api/orders/[id]/reject/route";
import * as resubmitRoute from "@/app/api/orders/[id]/resubmit/route";
import type { OrderDetailDto } from "@/lib/services/order-dto";
import { seedDemoUsers } from "./auth";
import { as, seedRecipes } from "./orders";

export type VerificationContext = Awaited<ReturnType<typeof setupVerification>>;

export async function setupVerification() {
  const users = await seedDemoUsers();
  const recipes = await seedRecipes();
  return { users, recipes };
}

export async function createPending(
  ctx: VerificationContext,
  overrides: Partial<{ recipeId: string; targetQty: number; fabricRollId: string; actualFabricYds: string | number }> = {},
) {
  const body = {
    recipeId: ctx.recipes.blouse.id,
    targetQty: 50,
    fabricRollId: `ROLL-${randomUUID().slice(0, 8)}`,
    actualFabricYds: "91.00",
    ...overrides,
  };
  const response = await orderRoute.POST(await as(ctx.users.supervisor.id, "POST", "/api/orders", { body }), undefined);
  if (response.status !== 201) throw new Error(`Could not create fixture order (${response.status})`);
  return (await response.json()).data.order as OrderDetailDto;
}

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

export const saveCountsRequest = async (
  id: string,
  userId: string | null,
  body: unknown,
  headers?: Record<string, string>,
) => countsRoute.PUT(await as(userId, "PUT", `/api/orders/${id}/counts`, { body, headers }), routeContext(id));

export const approveRequest = async (
  id: string,
  userId: string | null,
  body?: unknown,
  headers?: Record<string, string>,
) => approveRoute.POST(await as(userId, "POST", `/api/orders/${id}/approve`, { body, headers }), routeContext(id));

export const rejectRequest = async (
  id: string,
  userId: string | null,
  body: unknown,
  headers?: Record<string, string>,
) => rejectRoute.POST(await as(userId, "POST", `/api/orders/${id}/reject`, { body, headers }), routeContext(id));

export const resubmitRequest = async (id: string, userId: string | null, body?: unknown) =>
  resubmitRoute.POST(await as(userId, "POST", `/api/orders/${id}/resubmit`, { body }), routeContext(id));

export const listOrdersRequest = async (userId: string | null, query = "") =>
  orderRoute.GET(await as(userId, "GET", `/api/orders${query}`), undefined);

export const getOrderRequest = async (id: string, userId: string | null) =>
  orderByIdRoute.GET(await as(userId, "GET", `/api/orders/${id}`), routeContext(id));

export const countsFor = (
  order: OrderDetailDto,
  overrides: Record<string, number> = {},
) => ({
  counts: order.items.map((item) => ({
    componentId: item.componentId,
    actualQty: overrides[item.componentId] ?? item.expectedQty,
  })),
});

export const responseOrder = async (response: Response): Promise<OrderDetailDto> => (await response.json()).data.order;
