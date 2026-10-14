import { beforeEach, describe, expect, it, vi } from "vitest";
import * as orderRoute from "@/app/api/orders/route";
import * as orderByIdRoute from "@/app/api/orders/[id]/route";
import * as recipesRoute from "@/app/api/recipes/route";
import { PrismaClient } from "@/generated/prisma/client";
import { handle } from "@/lib/api/handle";
import * as orderItems from "@/lib/services/order-items";
import { createOrder } from "@/lib/services/orders";
import { makeUser, seedDemoUsers } from "../helpers/auth";
import { prisma } from "../helpers/db";
import { as, BLOUSE, CROP_TOP, seedRecipes } from "../helpers/orders";

type Ctx = { blouse: { id: string }; crop: { id: string }; sup: string; ver: string; sew: string };
let ctx: Ctx;

beforeEach(async () => {
  const users = await seedDemoUsers();
  const { blouse, crop } = await seedRecipes();
  ctx = { blouse, crop, sup: users.supervisor.id, ver: users.verifier.id, sew: users.sewing.id };
});

const valid = (over: Record<string, unknown> = {}) => ({
  recipeId: ctx.blouse.id,
  targetQty: 50,
  fabricRollId: "FAB-ROLL-882",
  actualFabricYds: "91.00",
  ...over,
});
const withoutKey = (key: string) => {
  const body: Record<string, unknown> = valid();
  delete body[key];
  return body;
};
/** Drive an API-created order to VERIFIED through the real legal path (count, approve, then flip). */
const verifyDirectly = async (orderId: string) => {
  await prisma.$executeRaw`UPDATE verification_items SET actual_qty = expected_qty, status = 'GREEN' WHERE order_id = ${orderId}`;
  await prisma.verificationLog.create({
    data: { orderId, attemptNo: 1, verifierId: ctx.ver, decision: "APPROVED", expectedFabricYds: "90.00", actualFabricYds: "91.00", wastagePct: "1.11", wastageCapPct: "5.00", overCap: false },
  });
  await prisma.cuttingOrder.update({ where: { id: orderId }, data: { status: "VERIFIED" } });
};
const create = async (body: unknown, userId: string | null = ctx.sup, headers?: Record<string, string>) =>
  orderRoute.POST(await as(userId, "POST", "/api/orders", { body, headers }), undefined);
const list = async (query = "", userId: string | null = ctx.sup) =>
  orderRoute.GET(await as(userId, "GET", `/api/orders${query}`), undefined);
const getById = async (id: string, userId: string | null = ctx.sup) =>
  orderByIdRoute.GET(await as(userId, "GET", `/api/orders/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });
const recipes = async (userId: string | null = ctx.sup) => recipesRoute.GET(await as(userId, "GET", "/api/recipes"), undefined);
const orderCount = () => prisma.cuttingOrder.count();
const expectedByName = (items: { componentName: string; expectedQty: number }[]) =>
  Object.fromEntries(items.map((i) => [i.componentName, i.expectedQty]));

describe("authentication and roles on POST /api/orders", () => {
  it("O1: no session is 401", async () => {
    const res = await create(valid(), null);
    expect(res.status).toBe(401);
    expect(await orderCount()).toBe(0);
  });

  it("O2: verifier and sewing supervisor get 403 and no order is created", async () => {
    for (const id of [ctx.ver, ctx.sew]) {
      const res = await create(valid(), id);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
    }
    expect(await orderCount()).toBe(0);
    expect(await prisma.verificationItem.count()).toBe(0);
  });

  it("checks the role before the body, so a wrong role learns nothing about validation", async () => {
    expect((await create({ junk: true }, ctx.ver)).status).toBe(403);
    expect((await create("not json", ctx.sew)).status).toBe(403);
    expect((await create({ junk: true }, null)).status).toBe(401);
  });

  it("a deactivated or deleted supervisor is 401", async () => {
    await prisma.user.update({ where: { id: ctx.sup }, data: { isActive: false } });
    expect((await create(valid())).status).toBe(401);
    const gone = await makeUser("cutting_supervisor");
    const req = await as(gone.id, "POST", "/api/orders", { body: valid() });
    await prisma.user.delete({ where: { id: gone.id } });
    expect((await orderRoute.POST(req, undefined)).status).toBe(401);
  });

  it("a role downgrade after login takes effect immediately", async () => {
    const req = () => as(ctx.sup, "POST", "/api/orders", { body: valid() });
    expect((await orderRoute.POST(await req(), undefined)).status).toBe(201);
    await prisma.user.update({ where: { id: ctx.sup }, data: { role: "cutting_verifier" } });
    expect((await orderRoute.POST(await req(), undefined)).status).toBe(403);
  });

  it("rejects a foreign Origin with CSRF_ORIGIN before anything else", async () => {
    const res = await create(valid(), ctx.sup, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_ORIGIN");
    expect(await orderCount()).toBe(0);
    expect((await create(valid(), ctx.sup, { origin: "http://localhost:3000" })).status).toBe(201);
  });
});

describe("creating an order", () => {
  it("O3: a valid blouse order of 50 is created pending, attempt 1, with a CUT- number", async () => {
    const res = await create(valid());
    expect(res.status).toBe(201);
    const { order } = (await res.json()).data;
    expect(order).toMatchObject({
      status: "PENDING_VERIFICATION",
      currentAttempt: 1,
      targetQty: 50,
      fabricRollId: "FAB-ROLL-882",
      actualFabricYds: "91.00",
      recipe: { id: ctx.blouse.id, recipeCode: "REC-BL01", name: "Casual Blouse" },
      createdBy: { id: ctx.sup, fullName: "Cutting Supervisor" },
    });
    expect(order.orderNo).toMatch(/^CUT-\d{5,}$/);
    expect(new Date(order.createdAt).toISOString()).toBe(order.createdAt);
  });

  it("O4: the blouse multiplier gives 50, 50, 100, 50, 100 across 5 item rows", async () => {
    const { order } = (await (await create(valid())).json()).data;
    const expected = { "Front Body Panel": 50, "Back Body Panel": 50, "Sleeves (Left & Right)": 100, "Collar & Stand": 50, "Sleeve Cuffs": 100 };
    expect(expectedByName(order.items)).toEqual(expected);
    const rows = await prisma.verificationItem.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(5);
    expect(expectedByName(rows)).toEqual(expected);
  });

  it("O5: the crop top multiplier for 20 gives 20, 20, 20, 20, 40", async () => {
    const { order } = (await (await create(valid({ recipeId: ctx.crop.id, targetQty: 20 }))).json()).data;
    expect(expectedByName(order.items)).toEqual({
      "Front Chest Panel": 20, "Back Support Panel": 20, "Neck Binding Strip": 20, "Hem Elastic Casing": 20, "Side Strap Accents": 40,
    });
    expect(await prisma.verificationItem.count({ where: { orderId: order.id } })).toBe(5);
    expect(CROP_TOP.components).toHaveLength(5);
  });

  it("O6: items start uncounted, attempt 1, with the recipe's component names as snapshots", async () => {
    const { order } = (await (await create(valid())).json()).data;
    const rows = await prisma.verificationItem.findMany({ where: { orderId: order.id }, include: { component: true } });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.actualQty).toBeNull();
      expect(row.status).toBeNull();
      expect(row.attemptNo).toBe(1);
      expect(row.componentName).toBe(row.component.componentName);
    }
    for (const item of order.items) expect(item).toMatchObject({ actualQty: null, status: null });
    expect(new Set(BLOUSE.components.map(([n]) => n))).toEqual(new Set(rows.map((r) => r.componentName)));
  });

  it("item snapshots do not change when the recipe is edited afterwards", async () => {
    const { order } = (await (await create(valid())).json()).data;
    await prisma.recipeComponent.updateMany({ where: { componentName: "Sleeve Cuffs" }, data: { componentName: "Renamed", piecesPerGarment: 9 } });
    const detail = (await (await getById(order.id)).json()).data.order;
    expect(expectedByName(detail.items)["Sleeve Cuffs"]).toBe(100);
  });

  it.each(["status", "createdBy", "createdById", "currentAttempt", "orderNo", "id", "createdAt", "updatedAt", "sewingStartedById", "sewingStartedAt", "items", "recipe"])(
    "O7: a body that sets %s is a 400 and creates nothing",
    async (key) => {
      const value = key === "status" ? "VERIFIED" : key === "currentAttempt" ? 5 : key.endsWith("By") || key === "createdById" ? ctx.ver : "x";
      const res = await create(valid({ [key]: value }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.fields[key]).toBeDefined();
      expect(await orderCount()).toBe(0);
    },
  );

  it("O7: all the tamper fields together, plus a prototype-pollution attempt", async () => {
    const res = await orderRoute.POST(
      await as(ctx.sup, "POST", "/api/orders", {
        body: `{"recipeId":"${ctx.blouse.id}","targetQty":5,"fabricRollId":"FAB-1","actualFabricYds":"1","status":"VERIFIED","createdBy":"${ctx.ver}","currentAttempt":9,"orderNo":"CUT-00001","__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}`,
      }),
      undefined,
    );
    expect(res.status).toBe(400);
    expect(await orderCount()).toBe(0);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it("O8: the creator is the logged-in supervisor, whoever that is", async () => {
    const other = await makeUser("cutting_supervisor");
    const a = (await (await create(valid(), ctx.sup)).json()).data.order;
    const b = (await (await create(valid(), other.id)).json()).data.order;
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: a.id } })).createdById).toBe(ctx.sup);
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: b.id } })).createdById).toBe(other.id);
  });

  it("two identical submissions create two separate orders (no idempotency key this milestone)", async () => {
    const a = (await (await create(valid())).json()).data.order;
    const b = (await (await create(valid())).json()).data.order;
    expect(a.orderNo).not.toBe(b.orderNo);
    expect(await orderCount()).toBe(2);
  });

  it("accepts the boundaries: target 1 and 100000", async () => {
    expect((await create(valid({ targetQty: 1 }))).status).toBe(201);
    const big = await create(valid({ targetQty: 100_000 }));
    expect(big.status).toBe(201);
    expect(expectedByName((await big.json()).data.order.items)["Sleeve Cuffs"]).toBe(200_000);
  });
});

describe("validation: raw requests, no UI", () => {
  const rejects = async (field: string, value: unknown, over: Record<string, unknown> = {}) => {
    const before = await orderCount();
    const res = await create(valid({ [field]: value, ...over }));
    expect(res.status, `${field}=${JSON.stringify(value)}`).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields[field], `${field}=${JSON.stringify(value)}`).toEqual(expect.any(String));
    expect(await orderCount()).toBe(before);
  };

  it.each([0, -1, 5.5, "50", "1e3", "", " ", null, 100_001, "NaN", "50.0", true, [], {}, [50], 1e21, 0.5])("O9: targetQty %j is a 400 with fields.targetQty", (v) => rejects("targetQty", v));
  it("O9: a missing targetQty is a 400 with fields.targetQty", async () => {
    const res = await create(withoutKey("targetQty"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.targetQty).toEqual(expect.any(String));
  });
  it("O9: NaN and Infinity (which JSON.stringify turns into null) are rejected", async () => {
    await rejects("targetQty", NaN);
    await rejects("targetQty", Infinity);
  });

  it.each([0, "0.00", -1, "1e3", "12.345", "abc", "", " ", null, "1,5", "007", "1000000", "-0", ".5", "5.", "+5", " 12", "12 ", true, [], {}, 1_000_000, 0.001, 1e21, "0x10", "Infinity"])(
    "O10: actualFabricYds %j is a 400 with fields.actualFabricYds",
    (v) => rejects("actualFabricYds", v),
  );
  it("O10: a missing actualFabricYds is a 400", async () => {
    expect((await create(withoutKey("actualFabricYds"))).status).toBe(400);
  });

  it.each([
    ["12", "12.00"], ["12.5", "12.50"], ["12.50", "12.50"], [12.5, "12.50"], ["999999.99", "999999.99"], ["0.01", "0.01"], [91, "91.00"],
  ])("O11: actualFabricYds %j is stored exactly as %s", async (input, stored) => {
    const res = await create(valid({ actualFabricYds: input }));
    expect(res.status).toBe(201);
    const { order } = (await res.json()).data;
    expect(order.actualFabricYds).toBe(stored);
    const row = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.actualFabricYds.toFixed(2)).toBe(stored);
  });

  it.each(["", " ", "AB", "x".repeat(41), "FAB ROLL", "-X1", "<script>", "FAB/1", "FAB'1", "'; DROP TABLE cutting_orders; --", 123, null, "ΑΒΓ-1", "FAB\n1"])(
    "O12: fabricRollId %j is a 400 with fields.fabricRollId",
    (v) => rejects("fabricRollId", v),
  );
  it("O12: a missing fabricRollId is a 400", async () => {
    expect((await create(withoutKey("fabricRollId"))).status).toBe(400);
  });

  it("O13: fabricRollId ' FAB-ROLL-882 ' is stored trimmed", async () => {
    const res = await create(valid({ fabricRollId: " FAB-ROLL-882 " }));
    expect(res.status).toBe(201);
    const { order } = (await res.json()).data;
    expect(order.fabricRollId).toBe("FAB-ROLL-882");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: order.id } })).fabricRollId).toBe("FAB-ROLL-882");
  });

  it("the same roll on two orders is allowed and stored as typed (case-sensitive)", async () => {
    expect((await create(valid({ fabricRollId: "fab-roll-1" }))).status).toBe(201);
    expect((await create(valid({ fabricRollId: "FAB-ROLL-1" }))).status).toBe(201);
    expect((await create(valid({ fabricRollId: "FAB-ROLL-1" }))).status).toBe(201);
  });

  it.each(["no-such-recipe", "' OR 1=1 --", "x".repeat(64), "REC-BL01"])("O14: unknown recipeId %j is a 400 with fields.recipeId (not 404, not 500)", async (v) => {
    await rejects("recipeId", v);
  });
  it.each(["", "x".repeat(65), 5, null, [], {}])("O14: malformed recipeId %j is a 400 with fields.recipeId", (v) => rejects("recipeId", v));
  it("O14: a missing recipeId is a 400 with fields.recipeId", async () => {
    const res = await create(withoutKey("recipeId"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.recipeId).toEqual(expect.any(String));
  });

  it.each(["{not json", "", "   ", "[]", "[{}]", "null", '"text"', "42", "true", "{", "{}"])("O15: body %j is a 400", async (text) => {
    const res = await create(text);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await orderCount()).toBe(0);
  });
  it("O15: no body at all, and an oversized body, are a 400", async () => {
    expect((await orderRoute.POST(await as(ctx.sup, "POST", "/api/orders"), undefined)).status).toBe(400);
    expect((await create(valid({ fabricRollId: "x".repeat(20_000) }))).status).toBe(400);
  });

  it("reports every invalid field at once so the form can show them together", async () => {
    const res = await create({ recipeId: "", targetQty: 0, fabricRollId: "", actualFabricYds: "0" });
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["actualFabricYds", "fabricRollId", "recipeId", "targetQty"]);
  });

  it("an unknown recipe does not consume an order number", async () => {
    const first = (await (await create(valid())).json()).data.order.orderNo;
    await create(valid({ recipeId: "nope" }));
    const third = (await (await create(valid())).json()).data.order.orderNo;
    expect(Number(third.slice(4)) - Number(first.slice(4))).toBe(1);
  });
});

describe("atomicity and concurrency", () => {
  it("O16: two supervisors creating 10 orders at once get 10 distinct numbers", async () => {
    const other = await makeUser("cutting_supervisor");
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => create(valid({ targetQty: i + 1 }), i % 2 ? other.id : ctx.sup)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    const numbers = (await Promise.all(results.map((r) => r.json()))).map((b) => b.data.order.orderNo);
    expect(new Set(numbers).size).toBe(10);
    expect(await prisma.verificationItem.count()).toBe(50);
  });

  it("O17: if the item insert fails after the order insert, no order row remains", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(orderItems, "insertAttemptItems").mockRejectedValueOnce(new Error("boom: items could not be written"));
    const res = await create(valid());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toEqual({ code: "INTERNAL", message: "Something went wrong" });
    expect(text).not.toContain("boom");
    expect(await orderCount()).toBe(0);
    expect(await prisma.verificationItem.count()).toBe(0);
    spy.mockRestore();
    log.mockRestore();
    expect((await create(valid())).status).toBe(201); // and the next create works
  });

  it("O17: a real database failure while inserting items also rolls the order back", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const huge = await prisma.recipe.create({
      data: { recipeCode: "REC-HUGE", name: "Huge", category: "x", stdFabricYards: "1", wastageCap: "1", components: { create: [{ componentName: "Mega", piecesPerGarment: 50_000 }] } },
    });
    const res = await create(valid({ recipeId: huge.id, targetQty: 100_000 })); // 5,000,000,000 pieces does not fit an int
    expect(res.status).toBe(500);
    expect(await orderCount()).toBe(0);
    log.mockRestore();
  });

  it("a database trigger rejection through the typed client is mapped to a clean 403, with no SQL text", async () => {
    // Bypass requireRole on purpose: the service is handed a "supervisor" that is really a verifier.
    const disguised = { id: ctx.ver, email: "v@x", fullName: "V", role: "cutting_supervisor" as const };
    const res = await handle(async () => {
      await createOrder(disguised, { recipeId: ctx.blouse.id, targetQty: 5, fabricRollId: "FAB-1", actualFabricYds: "1.00" });
      return new Response();
    })(new Request("http://localhost/x"), undefined);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toMatch(/created_by|cutting_supervisor|PostgresError|GK403/);
    expect(await orderCount()).toBe(0);
  });

  it("the service refuses a non-supervisor itself, even if a route forgot requireRole", async () => {
    const verifier = { id: ctx.ver, email: "v@x", fullName: "V", role: "cutting_verifier" as const };
    await expect(createOrder(verifier, { recipeId: ctx.blouse.id, targetQty: 5, fabricRollId: "FAB-1", actualFabricYds: "1.00" })).rejects.toMatchObject({ status: 403 });
    expect(await orderCount()).toBe(0);
  });
});

describe("GET /api/orders", () => {
  it("O18: lists newest first with recipe and creator names", async () => {
    const first = (await (await create(valid({ targetQty: 1 }))).json()).data.order;
    const second = (await (await create(valid({ targetQty: 2, recipeId: ctx.crop.id }))).json()).data.order;
    const third = (await (await create(valid({ targetQty: 3 }))).json()).data.order;

    const res = await list();
    expect(res.status).toBe(200);
    const { orders, hasMore } = (await res.json()).data;
    expect(orders.map((o: { id: string }) => o.id)).toEqual([third.id, second.id, first.id]);
    expect(hasMore).toBe(false);
    expect(orders[1]).toMatchObject({ recipe: { recipeCode: "REC-CT02", name: "Crop Top" }, createdBy: { fullName: "Cutting Supervisor" } });
    expect(orders[0]).not.toHaveProperty("items");
  });

  it("an empty list is a 200 with no orders", async () => {
    expect((await (await list()).json()).data).toEqual({ orders: [], hasMore: false });
  });

  it("O19: verifier and sewing get 403, no session gets 401", async () => {
    expect((await list("", ctx.ver)).status).toBe(403);
    expect((await list("", ctx.sew)).status).toBe(403);
    expect((await list("", null)).status).toBe(401);
  });

  it("O20: ?status filters, and an unknown status is a 400", async () => {
    const pending = (await (await create(valid())).json()).data.order;
    const verified = (await (await create(valid({ targetQty: 7 }))).json()).data.order;
    await verifyDirectly(verified.id);
    const ids = async (q: string) => (await (await list(q)).json()).data.orders.map((o: { orderNo: string }) => o.orderNo);

    expect(await ids("?status=VERIFIED")).toEqual([verified.orderNo]);
    expect(await ids("?status=PENDING_VERIFICATION")).toEqual([pending.orderNo]);
    expect(await ids("?status=PENDING_VERIFICATION")).toHaveLength(1);
    expect(await ids("?status=IN_SEWING")).toEqual([]);
    expect(await ids("")).toHaveLength(2);
    for (const bad of ["?status=bogus", "?status=verified", "?status=", "?status=VERIFIED&status=REJECTED", "?status=%27%20OR%201%3D1"]) {
      const res = await list(bad);
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error.fields.status).toEqual(expect.any(String));
    }
  });

  it("O21: bad limits are a 400, good limits page with hasMore", async () => {
    for (const bad of ["0", "101", "abc", "5.5", "", "-1", "1e1", "010", "1&limit=2", "%20"]) {
      const res = await list(`?limit=${bad}`);
      expect(res.status, `limit=${bad}`).toBe(400);
      expect((await res.json()).error.fields.limit).toEqual(expect.any(String));
    }
    for (let i = 0; i < 3; i++) await create(valid({ targetQty: i + 1 }));
    expect((await (await list("?limit=2")).json()).data).toMatchObject({ hasMore: true, orders: expect.arrayContaining([expect.anything()]) });
    expect((await (await list("?limit=2")).json()).data.orders).toHaveLength(2);
    expect((await (await list("?limit=3")).json()).data.hasMore).toBe(false);
    expect((await (await list("?limit=100")).json()).data.orders).toHaveLength(3);
  });

  it("O27: never contains password or token fields", async () => {
    await create(valid());
    const text = await (await list()).text();
    expect(text).not.toMatch(/passwordHash|password_hash|tokenHash|token_hash|refresh|"email"|\$2[aby]\$/i);
  });
});

describe("GET /api/orders/:id", () => {
  it("O22: returns the order with its expected counts; an unknown id is a 404", async () => {
    const { order } = (await (await create(valid())).json()).data;
    const res = await getById(order.id);
    expect(res.status).toBe(200);
    const detail = (await res.json()).data.order;
    expect(detail).toMatchObject({ id: order.id, orderNo: order.orderNo, status: "PENDING_VERIFICATION", currentAttempt: 1 });
    expect(expectedByName(detail.items)["Sleeve Cuffs"]).toBe(100);
    expect(detail.items).toHaveLength(5);

    const missing = await getById("00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOT_FOUND");
  });

  it.each(["nope", "' OR 1=1 --", "../../etc/passwd", "x".repeat(2000), "%00", "a b"])("O22: odd id %j is a clean 404", async (id) => {
    expect((await getById(id)).status).toBe(404);
  });

  it("O23: verifier, sewing and no session get 403 / 403 / 401, even for an id that does not exist", async () => {
    const { order } = (await (await create(valid())).json()).data;
    for (const id of [order.id, "does-not-exist"]) {
      expect((await getById(id, ctx.ver)).status).toBe(403);
      expect((await getById(id, ctx.sew)).status).toBe(403);
      expect((await getById(id, null)).status).toBe(401);
    }
  });

  it("O25: decimals are strings with two places", async () => {
    const { order } = (await (await create(valid({ actualFabricYds: "12.5" }))).json()).data;
    expect((await (await getById(order.id)).json()).data.order.actualFabricYds).toBe("12.50");
  });

  it("O26: a created order persists and is readable through a fresh client and the API", async () => {
    const { order } = (await (await create(valid({ actualFabricYds: "12.5" }))).json()).data;
    const fresh = new PrismaClient();
    try {
      const row = await fresh.cuttingOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      expect(row).toMatchObject({ orderNo: order.orderNo, status: "PENDING_VERIFICATION", currentAttempt: 1, createdById: ctx.sup });
      expect(row.items).toHaveLength(5);
    } finally {
      await fresh.$disconnect();
    }
    expect((await (await getById(order.id)).json()).data.order).toEqual(order);
  });
});

describe("GET /api/recipes", () => {
  it("O24: the supervisor gets 2 recipes with 10 components; verifier and sewing get 403; no session 401", async () => {
    const res = await recipes();
    expect(res.status).toBe(200);
    const { recipes: data } = (await res.json()).data;
    expect(data).toHaveLength(2);
    expect(data.map((r: { recipeCode: string }) => r.recipeCode)).toEqual(["REC-BL01", "REC-CT02"]);
    expect(data.reduce((n: number, r: { components: unknown[] }) => n + r.components.length, 0)).toBe(10);
    expect(data[0].components).toHaveLength(5);
    expect(data[0].components.map((c: { componentName: string }) => c.componentName)).toEqual(
      [...data[0].components.map((c: { componentName: string }) => c.componentName)].sort(),
    );

    expect((await recipes(ctx.ver)).status).toBe(403);
    expect((await recipes(ctx.sew)).status).toBe(403);
    expect((await recipes(null)).status).toBe(401);
  });

  it("O25: stdFabricYards and wastageCap are strings with two places", async () => {
    const { recipes: data } = (await (await recipes()).json()).data;
    expect(data[0]).toMatchObject({ stdFabricYards: "1.80", wastageCap: "5.00" });
    expect(data[1]).toMatchObject({ stdFabricYards: "1.10", wastageCap: "8.00" });
  });
});

describe("sewing supervisor reaches no order data", () => {
  it("O28: every Day 2 order endpoint is closed to the sewing role (and to the verifier)", async () => {
    const { order } = (await (await create(valid())).json()).data;
    for (const id of [ctx.sew, ctx.ver]) {
      expect((await create(valid(), id)).status).toBe(403);
      expect((await list("", id)).status).toBe(403);
      expect((await list("?status=VERIFIED", id)).status).toBe(403);
      expect((await getById(order.id, id)).status).toBe(403);
      expect((await recipes(id)).status).toBe(403);
    }
  });

  it("only the agreed methods are exported", () => {
    expect(Object.keys(orderRoute).sort()).toEqual(["GET", "POST"]);
    expect(Object.keys(orderByIdRoute)).toEqual(["GET"]); // no PUT/PATCH/DELETE: orders cannot be edited or deleted over HTTP
    expect(Object.keys(recipesRoute)).toEqual(["GET"]); // recipes are read-only
  });
});
