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
  sewingQueueRequest,
  snapshotState,
} from "../helpers/sewing";

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
      await wait(15);
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
