import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import * as meRoute from "@/app/api/me/route";
import * as recipesRoute from "@/app/api/recipes/route";
import { as } from "../helpers/orders";
import { createOneOfEachStatus, sewingActiveRequest, sewingDetailRequest, sewingQueueRequest, sewingStartRequest, snapshotState } from "../helpers/sewing";
import {
  approveRequest,
  countsFor,
  getOrderRequest,
  listOrdersRequest,
  rejectRequest,
  resubmitRequest,
  saveCountsRequest,
  setupVerification,
  type VerificationContext,
} from "../helpers/verification";
import * as ordersRoute from "@/app/api/orders/route";

// One table, every endpoint of Days 2 to 4, every identity. Each case runs on fresh fixtures (one
// order in every status). A refused request (401 or 403) must change no row at all.

type Role = "none" | "supervisor" | "verifier" | "sewing";
type Fixtures = Awaited<ReturnType<typeof createOneOfEachStatus>>;
type Case = {
  endpoint: string;
  /** Runs once per role on fresh fixtures, before the request. */
  prepare?: (ctx: VerificationContext, fx: Fixtures) => Promise<void>;
  run: (userId: string | null, ctx: VerificationContext, fx: Fixtures) => Promise<Response>;
  expect: Record<Role, number>;
};

const ROLES: Role[] = ["none", "supervisor", "verifier", "sewing"];

const validOrder = (ctx: VerificationContext) => ({
  recipeId: ctx.recipes.blouse.id,
  targetQty: 20,
  fabricRollId: "RBAC-ROLL",
  actualFabricYds: "40.00",
});

const CASES: Case[] = [
  { endpoint: "GET /api/me", run: async (u) => meRoute.GET(await as(u, "GET", "/api/me"), undefined), expect: { none: 401, supervisor: 200, verifier: 200, sewing: 200 } },
  { endpoint: "GET /api/recipes", run: async (u) => recipesRoute.GET(await as(u, "GET", "/api/recipes"), undefined), expect: { none: 401, supervisor: 200, verifier: 403, sewing: 403 } },
  {
    endpoint: "POST /api/orders",
    run: async (u, ctx) => ordersRoute.POST(await as(u, "POST", "/api/orders", { body: validOrder(ctx) }), undefined),
    expect: { none: 401, supervisor: 201, verifier: 403, sewing: 403 },
  },
  { endpoint: "GET /api/orders", run: (u) => listOrdersRequest(u), expect: { none: 401, supervisor: 200, verifier: 200, sewing: 403 } },
  { endpoint: "GET /api/orders/:id (pending)", run: (u, _c, fx) => getOrderRequest(fx.pending.id, u), expect: { none: 401, supervisor: 200, verifier: 200, sewing: 403 } },
  { endpoint: "GET /api/orders/:id (rejected)", run: (u, _c, fx) => getOrderRequest(fx.rejected.id, u), expect: { none: 401, supervisor: 200, verifier: 404, sewing: 403 } },
  { endpoint: "GET /api/orders/:id (verified)", run: (u, _c, fx) => getOrderRequest(fx.verified.id, u), expect: { none: 401, supervisor: 200, verifier: 404, sewing: 403 } },
  { endpoint: "GET /api/orders/:id (in sewing)", run: (u, _c, fx) => getOrderRequest(fx.inSewing.id, u), expect: { none: 401, supervisor: 200, verifier: 404, sewing: 403 } },
  {
    endpoint: "PUT /api/orders/:id/counts",
    run: (u, ctx, fx) => saveCountsRequest(fx.pending.id, u, countsFor(fx.pending)),
    expect: { none: 401, supervisor: 403, verifier: 200, sewing: 403 },
  },
  {
    endpoint: "POST /api/orders/:id/approve (fully counted)",
    prepare: async (ctx, fx) => void (await saveCountsRequest(fx.pending.id, ctx.users.verifier.id, countsFor(fx.pending))),
    run: (u, _c, fx) => approveRequest(fx.pending.id, u),
    expect: { none: 401, supervisor: 403, verifier: 200, sewing: 403 },
  },
  {
    endpoint: "POST /api/orders/:id/approve (uncounted: the hard stop)",
    run: (u, _c, fx) => approveRequest(fx.pending.id, u),
    expect: { none: 401, supervisor: 403, verifier: 422, sewing: 403 },
  },
  {
    endpoint: "POST /api/orders/:id/reject",
    run: (u, _c, fx) => rejectRequest(fx.pending.id, u, { note: "Seam open" }),
    expect: { none: 401, supervisor: 403, verifier: 200, sewing: 403 },
  },
  { endpoint: "POST /api/orders/:id/resubmit", run: (u, _c, fx) => resubmitRequest(fx.rejected.id, u), expect: { none: 401, supervisor: 200, verifier: 403, sewing: 403 } },
  { endpoint: "GET /api/sewing/queue", run: (u) => sewingQueueRequest(u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 200 } },
  { endpoint: "GET /api/sewing/active", run: (u) => sewingActiveRequest(u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 200 } },
  { endpoint: "GET /api/sewing/:id (verified)", run: (u, _c, fx) => sewingDetailRequest(fx.verified.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 200 } },
  { endpoint: "GET /api/sewing/:id (in sewing)", run: (u, _c, fx) => sewingDetailRequest(fx.inSewing.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 200 } },
  { endpoint: "GET /api/sewing/:id (pending)", run: (u, _c, fx) => sewingDetailRequest(fx.pending.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 404 } },
  { endpoint: "GET /api/sewing/:id (rejected)", run: (u, _c, fx) => sewingDetailRequest(fx.rejected.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 404 } },
  { endpoint: "GET /api/sewing/:id (unknown id)", run: (u) => sewingDetailRequest(randomUUID(), u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 404 } },
  { endpoint: "POST /api/sewing/:id/start (verified)", run: (u, _c, fx) => sewingStartRequest(fx.verified.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 200 } },
  { endpoint: "POST /api/sewing/:id/start (pending)", run: (u, _c, fx) => sewingStartRequest(fx.pending.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 404 } },
  { endpoint: "POST /api/sewing/:id/start (already in sewing)", run: (u, _c, fx) => sewingStartRequest(fx.inSewing.id, u), expect: { none: 401, supervisor: 403, verifier: 403, sewing: 409 } },
];

let ctx: VerificationContext;
let fx: Fixtures;
beforeEach(async () => {
  ctx = await setupVerification();
  fx = await createOneOfEachStatus(ctx);
});

describe("RBAC matrix (every endpoint of Days 2 to 4 against every identity)", () => {
  for (const testCase of CASES) {
    describe(testCase.endpoint, () => {
      for (const role of ROLES) {
        const expected = testCase.expect[role];
        it(`${role} -> ${expected}`, async () => {
          await testCase.prepare?.(ctx, fx);
          const before = await snapshotState();
          const userId = role === "none" ? null : ctx.users[role].id;

          const response = await testCase.run(userId, ctx, fx);
          expect(response.status).toBe(expected);

          if (expected === 401 || expected === 403) {
            // A refused request must not change a single row.
            expect(await snapshotState()).toEqual(before);
          }
        });
      }
    });
  }

  it("covers every API route file of Days 2 to 4", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(process.cwd(), "src/app/api");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "route.ts") routes.push(full.slice(root.length + 1, -"/route.ts".length));
      }
    };
    walk(root);
    // Auth routes (login, refresh, logout) are public by design and covered in auth.test.ts.
    const covered = new Set(["me", "recipes", "orders", "orders/[id]", "orders/[id]/counts", "orders/[id]/approve", "orders/[id]/reject", "orders/[id]/resubmit", "sewing/queue", "sewing/active", "sewing/[id]", "sewing/[id]/start"]);
    const protectedRoutes = routes.filter((route) => !route.startsWith("auth/"));
    expect(protectedRoutes.sort()).toEqual([...covered].sort());
  });
});

// The matrix above is only meaningful if the fixtures really are in every status.
describe("matrix fixtures", () => {
  it("has one order in each of the four statuses", async () => {
    const statuses = await Promise.all([fx.pending, fx.rejected, fx.verified, fx.inSewing].map(async (o) => (await getOrderRequest(o.id, ctx.users.supervisor.id).then((r) => r.json())).data.order.status));
    expect(statuses).toEqual(["PENDING_VERIFICATION", "REJECTED", "VERIFIED", "IN_SEWING"]);
  });
});
