import type { APIRequestContext, Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";

export const DEMO = {
  supervisor: { email: "cutting.supervisor@apparelflow.test", password: "Demo-Supervisor-1", label: "Cutting Supervisor", home: /\/orders/ },
  verifier: { email: "cutting.verifier@apparelflow.test", password: "Demo-Verifier-1", label: "Cutting Verifier", home: /\/verify/ },
  sewing: { email: "sewing.supervisor@apparelflow.test", password: "Demo-Sewing-1", label: "Sewing Supervisor", home: /\/sewing/ },
} as const;
export type Role = keyof typeof DEMO;

/** Sign in through the real login form, the way an evaluator does. */
export async function signInThroughForm(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO[role].email);
  await page.getByLabel("Password").fill(DEMO[role].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(DEMO[role].home);
}

/** The Role Switcher signs out and signs in again through the real login endpoint. */
export async function switchRole(page: Page, role: Role) {
  await page.getByLabel("Switch role").selectOption({ label: DEMO[role].label });
  await page.waitForURL(DEMO[role].home);
}

/** An API client that is already signed in (own cookie jar), for building fixtures quickly. */
export async function apiAs(role: Role, baseURL: string): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const response = await api.post("/api/auth/login", { data: { email: DEMO[role].email, password: DEMO[role].password } });
  if (!response.ok()) throw new Error(`Could not sign in as ${role}: ${response.status()}`);
  return api;
}

type Item = { componentId: string; expectedQty: number };
export type ApiOrder = { id: string; orderNo: string; items: Item[] };

export async function createOrderViaApi(supervisor: APIRequestContext, fabricRollId: string, targetQty = 50, yards = "91.00"): Promise<ApiOrder> {
  const recipes = (await (await supervisor.get("/api/recipes")).json()).data.recipes as { id: string; recipeCode: string }[];
  const blouse = recipes.find((r) => r.recipeCode === "REC-BL01")!;
  const response = await supervisor.post("/api/orders", { data: { recipeId: blouse.id, targetQty, fabricRollId, actualFabricYds: yards } });
  if (response.status() !== 201) throw new Error(`Could not create an order: ${response.status()}`);
  return (await response.json()).data.order;
}

export async function countAndApprove(verifier: APIRequestContext, order: ApiOrder) {
  const counts = order.items.map((i) => ({ componentId: i.componentId, actualQty: i.expectedQty }));
  if (!(await verifier.put(`/api/orders/${order.id}/counts`, { data: { counts } })).ok()) throw new Error("counts failed");
  const approved = await verifier.post(`/api/orders/${order.id}/approve`, { data: {} });
  if (!approved.ok()) throw new Error(`approve failed: ${approved.status()}`);
}
