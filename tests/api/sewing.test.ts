import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../helpers/db";
import {
  approveRequest,
  countsFor,
  createPending,
  saveCountsRequest,
  setupVerification,
  type VerificationContext,
} from "../helpers/verification";
import {
  createOneOfEachStatus,
  createRecutAndVerified,
  createVerified,
  sewingActiveRequest,
  sewingDetailRequest,
  sewingQueueRequest,
  sewingStartRequest,
  snapshotState,
} from "../helpers/sewing";
import { createRejected } from "../helpers/sewing";
import { expectDbError } from "../helpers/db";

let ctx: VerificationContext;
beforeEach(async () => {
  ctx = await setupVerification();
});

const queueOf = async (userId: string | null, query = "") => {
  const res = await sewingQueueRequest(userId, query);
  return { res, orders: ((await res.clone().json()).data?.orders ?? []) as { id: string; orderNo: string }[] };
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("sewing queue endpoint", () => {
  it("S1: no session is 401, supervisor and verifier are 403, and nothing changes", async () => {
    await createOneOfEachStatus(ctx);
    const before = await snapshotState();
    expect((await sewingQueueRequest(null)).status).toBe(401);
    expect((await sewingQueueRequest(ctx.users.supervisor.id)).status).toBe(403);
    expect((await sewingQueueRequest(ctx.users.verifier.id)).status).toBe(403);
    expect(await snapshotState()).toEqual(before);
  });

  it("S3: the endpoint returns exactly the VERIFIED order among all statuses", async () => {
    const { verified } = await createOneOfEachStatus(ctx);
    const { res, orders } = await queueOf(ctx.users.sewing.id);
    expect(res.status).toBe(200);
    expect(orders.map((o) => o.id)).toEqual([verified.id]);
  });

  it("S4: one verified order among 25 others in other statuses (raw SQL) returns exactly one", async () => {
    const verified = await createVerified(ctx);
    await prisma.$executeRaw`
      INSERT INTO cutting_orders (id, order_no, recipe_id, target_qty, fabric_roll_id, actual_fabric_yds, created_by, updated_at)
      SELECT gen_random_uuid()::text, 'BULK-' || n, ${ctx.recipes.blouse.id}, 10, 'BULK-ROLL', 20.00, ${ctx.users.supervisor.id}, now()
      FROM generate_series(1, 25) AS n`;
    expect(await prisma.cuttingOrder.count({ where: { status: "PENDING_VERIFICATION" } })).toBe(25);
    const { orders } = await queueOf(ctx.users.sewing.id);
    expect(orders.map((o) => o.id)).toEqual([verified.id]);
  });

  it("S5: tampering with query parameters never changes the result", async () => {
    const { pending, rejected } = await createOneOfEachStatus(ctx);
    const baseline = (await queueOf(ctx.users.sewing.id)).orders.map((o) => o.id);
    expect(baseline).toHaveLength(1);
    for (const query of [
      "?status=PENDING_VERIFICATION",
      "?status=",
      "?status=REJECTED&status=IN_SEWING",
      "?all=true",
      "?includeRejected=1",
      `?id=${pending.id}`,
      `?id=${rejected.id}`,
      "?where=1%3D1",
      "?orderBy=status&filter[status]=REJECTED",
    ]) {
      const { res, orders } = await queueOf(ctx.users.sewing.id, query);
      expect(res.status, query).toBe(200);
      expect(orders.map((o) => o.id), query).toEqual(baseline);
    }
  });

  it("S6: an invalid limit is a 400 with a field error", async () => {
    await createVerified(ctx);
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?limit=5.5", "?limit=", "?limit=-1", "?limit=1e1", "?limit=1&limit=2"]) {
      const res = await sewingQueueRequest(ctx.users.sewing.id, query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.fields.limit).toEqual(expect.any(String));
    }
    const ok = await queueOf(ctx.users.sewing.id, "?limit=1");
    expect(ok.res.status).toBe(200);
  });

  it("S6b: the limit really limits the list", async () => {
    await createVerified(ctx);
    await createVerified(ctx);
    expect((await queueOf(ctx.users.sewing.id, "?limit=1")).orders).toHaveLength(1);
    expect((await queueOf(ctx.users.sewing.id)).orders).toHaveLength(2);
  });

  it("S7: oldest approval first, not oldest creation first", async () => {
    const orders = [await createPending(ctx), await createPending(ctx), await createPending(ctx)];
    for (const order of orders) await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    // Created as 0, 1, 2 but approved as 1, 2, 0.
    for (const index of [1, 2, 0]) {
      expect((await approveRequest(orders[index].id, ctx.users.verifier.id)).status).toBe(200);
      await wait(60);
    }
    const { orders: queue } = await queueOf(ctx.users.sewing.id);
    expect(queue.map((o) => o.id)).toEqual([orders[1].id, orders[2].id, orders[0].id]);
  });

  it("S8: items carry approval facts but no rejection note, email, user id or hash", async () => {
    const order = await createVerified(ctx, { actualFabricYds: "94.60" });
    const res = await sewingQueueRequest(ctx.users.sewing.id);
    const text = await res.clone().text();
    const [card] = (await res.json()).data.orders;
    expect(card).toMatchObject({
      id: order.id,
      status: "VERIFIED",
      targetQty: 50,
      attemptNo: 1,
      recipe: { recipeCode: "REC-BL01", name: "Casual Blouse" },
      approval: { verifier: { fullName: "Cutting Verifier" }, wastagePct: "5.11", wastageCapPct: "5.00", overCap: true },
    });
    expect(new Date(card.approval.decidedAt).getTime()).not.toBeNaN();
    expect(card.sewingStartedBy).toBeUndefined();
    for (const forbidden of [ctx.users.verifier.id, ctx.users.supervisor.id, ctx.users.sewing.id, ctx.users.verifier.email, "@", "passwordHash", "password_hash", "rejection", "createdBy", "Demo-"]) {
      expect(text, `response must not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("S9: after reject, resubmit and approve only attempt 2 is shown and no rejection note appears", async () => {
    const { order, note } = await createRecutAndVerified(ctx);
    const res = await sewingQueueRequest(ctx.users.sewing.id);
    const text = await res.clone().text();
    const [card] = (await res.json()).data.orders;
    expect(card).toMatchObject({ id: order.id, attemptNo: 2 });
    expect(text).not.toContain(note);
    expect(text.toLowerCase()).not.toContain("reject");
  });

  it("S12a: the static segment is served by the queue handler, not captured by [id]", async () => {
    const res = await sewingQueueRequest(ctx.users.sewing.id);
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).data.orders)).toBe(true);
  });
});

const activeOf = async (userId: string | null, query = "") => {
  const res = await sewingActiveRequest(userId, query);
  return { res, orders: ((await res.clone().json()).data?.orders ?? []) as { id: string; sewingStartedBy?: { fullName: string }; sewingStartedAt?: string }[] };
};

describe("sewing active endpoint", () => {
  it("S1: no session is 401, supervisor and verifier are 403, and nothing changes", async () => {
    await createOneOfEachStatus(ctx);
    const before = await snapshotState();
    expect((await sewingActiveRequest(null)).status).toBe(401);
    expect((await sewingActiveRequest(ctx.users.supervisor.id)).status).toBe(403);
    expect((await sewingActiveRequest(ctx.users.verifier.id)).status).toBe(403);
    expect(await snapshotState()).toEqual(before);
  });

  it("returns exactly the IN_SEWING order, with who started it and when, and never a user id", async () => {
    const { inSewing } = await createOneOfEachStatus(ctx);
    const res = await sewingActiveRequest(ctx.users.sewing.id);
    const text = await res.clone().text();
    expect(res.status).toBe(200);
    const orders = (await res.json()).data.orders;
    expect(orders.map((o: { id: string }) => o.id)).toEqual([inSewing.id]);
    expect(orders[0]).toMatchObject({ status: "IN_SEWING", sewingStartedBy: { fullName: "Sewing Supervisor" }, attemptNo: 1 });
    expect(new Date(orders[0].sewingStartedAt).getTime()).not.toBeNaN();
    for (const forbidden of [ctx.users.sewing.id, ctx.users.verifier.id, ctx.users.sewing.email, "@", "rejection"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("an order is in exactly one of the two lists", async () => {
    const { verified, inSewing } = await createOneOfEachStatus(ctx);
    const queue = (await queueOf(ctx.users.sewing.id)).orders.map((o) => o.id);
    const active = (await activeOf(ctx.users.sewing.id)).orders.map((o) => o.id);
    expect(queue).toEqual([verified.id]);
    expect(active).toEqual([inSewing.id]);
  });

  it("S5: tampering with query parameters never changes the active list", async () => {
    await createOneOfEachStatus(ctx);
    const baseline = (await activeOf(ctx.users.sewing.id)).orders.map((o) => o.id);
    expect(baseline).toHaveLength(1);
    for (const query of ["?status=VERIFIED", "?status=PENDING_VERIFICATION", "?all=true", "?includeRejected=1", "?where=1%3D1"]) {
      const { res, orders } = await activeOf(ctx.users.sewing.id, query);
      expect(res.status, query).toBe(200);
      expect(orders.map((o) => o.id), query).toEqual(baseline);
    }
  });

  it("S6: an invalid limit is a 400 with a field error", async () => {
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?limit=5.5", "?limit="]) {
      const res = await sewingActiveRequest(ctx.users.sewing.id, query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.fields.limit).toEqual(expect.any(String));
    }
  });

  it("lists the most recently started order first", async () => {
    const first = await createVerified(ctx);
    const second = await createVerified(ctx);
    const startedAt = [new Date("2026-01-01T08:00:00Z"), new Date("2026-01-01T09:00:00Z")];
    for (const [index, order] of [first, second].entries()) {
      await prisma.cuttingOrder.update({
        where: { id: order.id },
        data: { status: "IN_SEWING", sewingStartedById: ctx.users.sewing.id, sewingStartedAt: startedAt[index] },
      });
    }
    expect((await activeOf(ctx.users.sewing.id)).orders.map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it("S12b: the static segment is served by the active handler, not captured by [id]", async () => {
    const res = await sewingActiveRequest(ctx.users.sewing.id);
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).data.orders)).toBe(true);
  });
});

describe("sewing detail endpoint", () => {
  it("S1: no session is 401, supervisor and verifier are 403 even for an unknown id", async () => {
    const { verified } = await createOneOfEachStatus(ctx);
    const before = await snapshotState();
    for (const id of [verified.id, randomUUID()]) {
      expect((await sewingDetailRequest(id, null)).status).toBe(401);
      expect((await sewingDetailRequest(id, ctx.users.supervisor.id)).status).toBe(403);
      expect((await sewingDetailRequest(id, ctx.users.verifier.id)).status).toBe(403);
    }
    expect(await snapshotState()).toEqual(before);
  });

  it("S10: a VERIFIED and an IN_SEWING order are both readable", async () => {
    const { verified, inSewing } = await createOneOfEachStatus(ctx);
    const a = await sewingDetailRequest(verified.id, ctx.users.sewing.id);
    const b = await sewingDetailRequest(inSewing.id, ctx.users.sewing.id);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await a.json()).data.order.status).toBe("VERIFIED");
    expect((await b.json()).data.order).toMatchObject({ status: "IN_SEWING", sewingStartedBy: { fullName: "Sewing Supervisor" } });
  });

  it("S11: pending, rejected, unknown and malformed ids are all the same 404", async () => {
    const { pending, rejected } = await createOneOfEachStatus(ctx);
    const before = await snapshotState();
    const bodies = new Set<string>();
    for (const id of [pending.id, rejected.id, randomUUID(), "not-a-uuid", "queue", "a%00b", ""]) {
      const res = await sewingDetailRequest(id, ctx.users.sewing.id);
      expect(res.status, id).toBe(404);
      bodies.add(JSON.stringify(await res.json()));
    }
    expect(bodies.size).toBe(1); // the sewing role cannot tell "exists but not yours" from "does not exist"
    expect(await snapshotState()).toEqual(before);
  });

  it("S8: detail shows the approved attempt's counts, variances and the full fabric snapshot", async () => {
    const order = await createVerified(ctx, { actualFabricYds: "94.60" });
    const res = await sewingDetailRequest(order.id, ctx.users.sewing.id);
    const text = await res.clone().text();
    const { order: detail } = (await res.json()).data;
    expect(detail.approval).toMatchObject({
      verifier: { fullName: "Cutting Verifier" },
      expectedFabricYds: "90.00",
      actualFabricYds: "94.60",
      wastagePct: "5.11",
      wastageCapPct: "5.00",
      overCap: true,
    });
    expect(detail.items).toHaveLength(5);
    for (const item of detail.items) {
      expect(item.actualQty).toBe(item.expectedQty);
      expect(item.variance).toBe(0);
      expect(["GREEN", "YELLOW"]).toContain(item.status);
      expect(Object.keys(item).sort()).toEqual(["actualQty", "componentName", "expectedQty", "status", "variance"]);
    }
    expect(detail.items.map((i: { componentName: string }) => i.componentName)).toEqual([...detail.items.map((i: { componentName: string }) => i.componentName)].sort());
    for (const forbidden of [ctx.users.verifier.id, ctx.users.supervisor.id, ctx.users.sewing.id, "@", "passwordHash", "rejection", "createdBy", "componentId"]) {
      expect(text, `response must not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("S8: a YELLOW (excess) count appears with its positive variance", async () => {
    const { createPending, saveCountsRequest, countsFor, approveRequest } = await import("../helpers/verification");
    const order = await createPending(ctx);
    const extra = order.items[0];
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order, { [extra.componentId]: extra.expectedQty + 3 }));
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(200);
    const detail = (await (await sewingDetailRequest(order.id, ctx.users.sewing.id)).json()).data.order;
    const row = detail.items.find((i: { componentName: string }) => i.componentName === extra.componentName);
    expect(row).toMatchObject({ status: "YELLOW", variance: 3 });
  });

  it("S9: after reject, resubmit and approve the detail shows attempt 2 only and no rejection note", async () => {
    const { order, note } = await createRecutAndVerified(ctx);
    const res = await sewingDetailRequest(order.id, ctx.users.sewing.id);
    const text = await res.clone().text();
    const { order: detail } = (await res.json()).data;
    expect(detail.attemptNo).toBe(2);
    expect(detail.items).toHaveLength(5);
    expect(text).not.toContain(note);
    expect(text.toLowerCase()).not.toContain("reject");
    expect(text).not.toContain("attempts");
  });

  it("S12: queue and active are their own route files next to [id], and [id] never serves them", async () => {
    const dir = join(process.cwd(), "src/app/api/sewing");
    expect(readdirSync(dir).sort()).toEqual(["[id]", "active", "queue"]);
    for (const segment of ["queue", "active"]) expect(existsSync(join(dir, segment, "route.ts"))).toBe(true);
    // Even if routing ever sent "queue" to [id], it would be a 404, never a list or an order.
    await createVerified(ctx);
    expect((await sewingDetailRequest("queue", ctx.users.sewing.id)).status).toBe(404);
    expect((await sewingDetailRequest("active", ctx.users.sewing.id)).status).toBe(404);
  });

  it("S20: the detail route exports GET only", async () => {
    const mod = await import("@/app/api/sewing/[id]/route");
    for (const method of ["PUT", "PATCH", "DELETE", "POST"]) expect(mod).not.toHaveProperty(method);
  });
});

describe("start sewing endpoint", () => {
  const stateOf = (id: string) => prisma.cuttingOrder.findUniqueOrThrow({ where: { id } });

  it("S13: starting a VERIFIED order releases it, records the session user and the database clock", async () => {
    const order = await createVerified(ctx);
    const [{ now: before }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    const res = await sewingStartRequest(order.id, ctx.users.sewing.id);
    const [{ now: after }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    expect(res.status).toBe(200);
    const { order: started } = (await res.json()).data;
    expect(started).toMatchObject({ id: order.id, status: "IN_SEWING", sewingStartedBy: { fullName: "Sewing Supervisor" } });

    const stored = await stateOf(order.id);
    expect(stored.status).toBe("IN_SEWING");
    expect(stored.sewingStartedById).toBe(ctx.users.sewing.id);
    expect(stored.sewingStartedAt).not.toBeNull();
    expect(stored.sewingStartedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stored.sewingStartedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(started.sewingStartedAt).toBe(stored.sewingStartedAt!.toISOString());
    expect(JSON.stringify(started)).not.toContain(ctx.users.sewing.id);
  });

  it("S14: starting twice gives 409 the second time and records one start", async () => {
    const order = await createVerified(ctx);
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id)).status).toBe(200);
    const firstStart = (await stateOf(order.id)).sewingStartedAt;
    const second = await sewingStartRequest(order.id, ctx.users.sewing.id);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("CONFLICT");
    expect((await stateOf(order.id)).sewingStartedAt).toEqual(firstStart);
  });

  it("S15: five concurrent starts give one 200, four 409s and exactly one recorded start", async () => {
    const order = await createVerified(ctx);
    const responses = await Promise.all(Array.from({ length: 5 }, () => sewingStartRequest(order.id, ctx.users.sewing.id)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    const stored = await stateOf(order.id);
    expect(stored.status).toBe("IN_SEWING");
    expect(stored.sewingStartedById).toBe(ctx.users.sewing.id);
  });

  it("S16: a pending or rejected order is a 404 and stays unchanged", async () => {
    const pending = await createPending(ctx);
    const rejected = await createRejected(ctx);
    const before = await snapshotState();
    for (const id of [pending.id, rejected.id, randomUUID()]) {
      const res = await sewingStartRequest(id, ctx.users.sewing.id);
      expect(res.status, id).toBe(404);
    }
    expect(await snapshotState()).toEqual(before);
    expect((await stateOf(pending.id)).status).toBe("PENDING_VERIFICATION");
    expect((await stateOf(rejected.id)).status).toBe("REJECTED");
  });

  it("S17: no session is 401, supervisor and verifier are 403 (even for an unknown id) and nothing changes", async () => {
    const order = await createVerified(ctx);
    const before = await snapshotState();
    for (const id of [order.id, randomUUID()]) {
      expect((await sewingStartRequest(id, null)).status).toBe(401);
      expect((await sewingStartRequest(id, ctx.users.supervisor.id)).status).toBe(403);
      expect((await sewingStartRequest(id, ctx.users.verifier.id)).status).toBe(403);
    }
    expect(await snapshotState()).toEqual(before);
  });

  it("S18: server-owned fields or any other body are a 400 and nothing changes", async () => {
    const order = await createVerified(ctx);
    const before = await snapshotState();
    for (const body of [
      { status: "IN_SEWING" },
      { sewingStartedBy: ctx.users.supervisor.id },
      { sewingStartedById: ctx.users.supervisor.id },
      { sewingStartedAt: "2020-01-01T00:00:00Z" },
      { anything: 1 },
      [],
      "x",
    ]) {
      const res = await sewingStartRequest(order.id, ctx.users.sewing.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await snapshotState()).toEqual(before);
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id, {})).status).toBe(200);
  });

  it("S18b: a malformed id is a 400 before any lookup", async () => {
    const before = await snapshotState();
    for (const id of ["not-a-uuid", "queue", "12345"]) {
      expect((await sewingStartRequest(id, ctx.users.sewing.id)).status, id).toBe(400);
    }
    expect(await snapshotState()).toEqual(before);
  });

  it("S19: after the start the order leaves the queue and appears in active with who and when", async () => {
    const order = await createVerified(ctx);
    expect((await queueOf(ctx.users.sewing.id)).orders.map((o) => o.id)).toEqual([order.id]);
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id)).status).toBe(200);
    expect((await queueOf(ctx.users.sewing.id)).orders).toEqual([]);
    const { orders } = await activeOf(ctx.users.sewing.id);
    expect(orders.map((o) => o.id)).toEqual([order.id]);
    expect(orders[0].sewingStartedBy).toEqual({ fullName: "Sewing Supervisor" });
    expect(new Date(orders[0].sewingStartedAt!).getTime()).not.toBeNaN();
  });

  it("S20: only POST exists on the start route, and the database blocks IN_SEWING -> VERIFIED", async () => {
    const mod = await import("@/app/api/sewing/[id]/start/route");
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) expect(mod).not.toHaveProperty(method);
    const order = await createVerified(ctx);
    await sewingStartRequest(order.id, ctx.users.sewing.id);
    await expectDbError(prisma.$executeRaw`UPDATE cutting_orders SET status = 'VERIFIED' WHERE id = ${order.id}`, "GK409");
    expect((await stateOf(order.id)).status).toBe("IN_SEWING");
  });

  it("S21: a foreign Origin is 403 CSRF_ORIGIN and nothing changes", async () => {
    const order = await createVerified(ctx);
    const res = await sewingStartRequest(order.id, ctx.users.sewing.id, {}, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_ORIGIN");
    expect((await stateOf(order.id)).status).toBe("VERIFIED");
  });

  it("a deactivated sewing supervisor cannot start sewing (401, the database guard is only a backstop)", async () => {
    const order = await createVerified(ctx);
    await prisma.user.update({ where: { id: ctx.users.sewing.id }, data: { isActive: false } });
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id)).status).toBe(401);
    expect((await stateOf(order.id)).status).toBe("VERIFIED");
  });

  it("the recorded attempt is the approved one after a re-cut", async () => {
    const { order } = await createRecutAndVerified(ctx);
    const res = await sewingStartRequest(order.id, ctx.users.sewing.id);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).data.order.attemptNo).toBe(2);
    expect(text.toLowerCase()).not.toContain("reject");
  });
});

describe("the constants the sewing safety rests on", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("the queue's status filter is the literal VERIFIED constant, in one function, with no parameter", () => {
    const queue = source("src/lib/services/sewing-queue.ts");
    expect(queue).toContain("WHERE o.status = 'VERIFIED'");
    expect(queue).toContain('status: "VERIFIED"'); // applied again when the rows are loaded
    expect(queue.match(/o\.status/g)).toHaveLength(1); // no second, parameterised status filter
    expect(queue).not.toMatch(/status\s*[:=]\s*(query|params|input|request)/i);
    expect(source("src/lib/services/sewing.ts")).toContain("WHERE o.status = 'IN_SEWING'");
  });

  it("the start time comes from the database clock, not the application's", () => {
    const service = source("src/lib/services/sewing.ts");
    expect(service).toContain("sewing_started_at = now()");
    expect(service).not.toMatch(/sewingStartedAt\s*:\s*new Date/);
  });
});
