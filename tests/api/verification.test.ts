import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import * as approveModule from "@/app/api/orders/[id]/approve/route";
import * as countsModule from "@/app/api/orders/[id]/counts/route";
import * as orderByIdModule from "@/app/api/orders/[id]/route";
import * as rejectModule from "@/app/api/orders/[id]/reject/route";
import * as resubmitModule from "@/app/api/orders/[id]/resubmit/route";
import { prisma } from "../helpers/db";
import {
  approveRequest,
  countsFor,
  createPending,
  getOrderRequest,
  listOrdersRequest,
  rejectRequest,
  resubmitRequest,
  responseOrder,
  saveCountsRequest,
  setupVerification,
  type VerificationContext,
} from "../helpers/verification";

let ctx: VerificationContext;
beforeEach(async () => {
  ctx = await setupVerification();
});

describe("PUT counts", () => {
  it("V1: unauthenticated, supervisor and sewing requests are 401 / 403 / 403", async () => {
    const order = await createPending(ctx);
    expect((await saveCountsRequest(order.id, null, countsFor(order))).status).toBe(401);
    expect((await saveCountsRequest(order.id, ctx.users.supervisor.id, countsFor(order))).status).toBe(403);
    expect((await saveCountsRequest(order.id, ctx.users.sewing.id, countsFor(order))).status).toBe(403);
    expect(await prisma.verificationItem.count({ where: { orderId: order.id, actualQty: { not: null } } })).toBe(0);
  });

  it("V2, V5 and V6: server computes full and partial GREEN/YELLOW/RED counts including zero", async () => {
    const order = await createPending(ctx);
    const [match, excess, shortage, untouched] = order.items;
    const response = await saveCountsRequest(order.id, ctx.users.verifier.id, {
      counts: [
        { componentId: match.componentId, actualQty: match.expectedQty },
        { componentId: excess.componentId, actualQty: excess.expectedQty + 1 },
        { componentId: shortage.componentId, actualQty: 0 },
      ],
    });
    expect(response.status).toBe(200);
    const saved = await responseOrder(response);
    const byId = Object.fromEntries(saved.items.map((item) => [item.componentId, item]));
    expect(byId[match.componentId].status).toBe("GREEN");
    expect(byId[excess.componentId].status).toBe("YELLOW");
    expect(byId[shortage.componentId]).toMatchObject({ actualQty: 0, status: "RED" });
    expect(byId[untouched.componentId]).toMatchObject({ actualQty: null, status: null });
  });

  it("V3 and V4: strict bodies reject status, extra keys, non-integers, strings and bounds", async () => {
    const order = await createPending(ctx);
    const componentId = order.items[0].componentId;
    for (const body of [
      { counts: [{ componentId, actualQty: 1, status: "GREEN" }] },
      { counts: [{ componentId, actualQty: 1 }], extra: true },
      ...[-1, 5.5, "5", "1e3", "", null, 10_000_001].map((actualQty) => ({ counts: [{ componentId, actualQty }] })),
    ]) {
      expect((await saveCountsRequest(order.id, ctx.users.verifier.id, body)).status).toBe(400);
    }
    expect(await prisma.verificationItem.count({ where: { orderId: order.id, actualQty: { not: null } } })).toBe(0);
  });

  it("V7: rejects unknown, foreign, duplicate, empty and over-50 component lists", async () => {
    const order = await createPending(ctx);
    const other = await createPending(ctx, { recipeId: ctx.recipes.crop.id });
    const valid = { componentId: order.items[0].componentId, actualQty: 1 };
    for (const body of [
      { counts: [{ componentId: randomUUID(), actualQty: 1 }] },
      { counts: [{ componentId: other.items[0].componentId, actualQty: 1 }] },
      { counts: [valid, valid] },
      { counts: [] },
      { counts: Array.from({ length: 51 }, () => ({ componentId: randomUUID(), actualQty: 1 })) },
    ]) {
      expect((await saveCountsRequest(order.id, ctx.users.verifier.id, body)).status).toBe(400);
    }
  });

  it("V8: a valid unknown order id is 404", async () => {
    expect((await saveCountsRequest(randomUUID(), ctx.users.verifier.id, { counts: [{ componentId: randomUUID(), actualQty: 1 }] })).status).toBe(404);
  });

  it("V9 and V10: counts overwrite while pending and return 409 after a decision", async () => {
    const order = await createPending(ctx);
    const item = order.items[0];
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, { counts: [{ componentId: item.componentId, actualQty: 0 }] })).status).toBe(200);
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, { counts: [{ componentId: item.componentId, actualQty: item.expectedQty }] })).status).toBe(200);
    expect((await rejectRequest(order.id, ctx.users.verifier.id, { note: "Damaged seam" })).status).toBe(200);
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, { counts: [{ componentId: item.componentId, actualQty: 0 }] })).status).toBe(409);
  });

  it("V11: after resubmit only attempt 2 items change", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order, { [order.items[0].componentId]: 0 }));
    await rejectRequest(order.id, ctx.users.verifier.id, { note: "Short" });
    const resubmitted = await responseOrder(await resubmitRequest(order.id, ctx.users.supervisor.id));
    await saveCountsRequest(resubmitted.id, ctx.users.verifier.id, countsFor(resubmitted));
    expect(await prisma.verificationItem.count({ where: { orderId: order.id, attemptNo: 1, status: "RED" } })).toBe(1);
    expect(await prisma.verificationItem.count({ where: { orderId: order.id, attemptNo: 2, status: "GREEN" } })).toBe(5);
  });

  it("V12: invalid JSON, wrong content type and foreign Origin return 400 / 400 / 403", async () => {
    const order = await createPending(ctx);
    const id = order.items[0].componentId;
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, "{bad")).status).toBe(400);
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, JSON.stringify({ counts: [{ componentId: id, actualQty: 1 }] }), { "content-type": "text/plain" })).status).toBe(400);
    const foreign = await saveCountsRequest(order.id, ctx.users.verifier.id, { counts: [{ componentId: id, actualQty: 1 }] }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error.code).toBe("CSRF_ORIGIN");
  });
});

describe("approve", () => {
  it("V21: server-owned approval fields are rejected", async () => {
    const order = await createPending(ctx);
    for (const key of ["verifierId", "decidedAt", "wastagePct", "status"]) {
      expect((await approveRequest(order.id, ctx.users.verifier.id, { [key]: "forged" })).status).toBe(400);
    }
  });

  it("V23 and V24: zero and uncounted components block with quantity-derived reasons", async () => {
    const order = await createPending(ctx);
    const zero = order.items[0];
    await saveCountsRequest(order.id, ctx.users.verifier.id, { counts: [{ componentId: zero.componentId, actualQty: 0 }] });
    const response = await approveRequest(order.id, ctx.users.verifier.id);
    expect(response.status).toBe(422);
    const blocking = (await response.json()).error.details.blocking;
    expect(blocking).toContainEqual(expect.objectContaining({ componentId: zero.componentId, reason: "SHORTAGE" }));
    expect(blocking.filter((item: { reason: string }) => item.reason === "UNCOUNTED")).toHaveLength(4);
  });

  it("V25: a deleted current-attempt row is reported as MISSING", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    const missing = order.items[0];
    await prisma.verificationItem.delete({ where: { orderId_componentId_attemptNo: { orderId: order.id, componentId: missing.componentId, attemptNo: 1 } } });
    const response = await approveRequest(order.id, ctx.users.verifier.id);
    expect(response.status).toBe(422);
    expect((await response.json()).error.details.blocking).toContainEqual(expect.objectContaining({ componentId: missing.componentId, reason: "MISSING" }));
  });

  it("V26, V27, V35 and V37: GREEN plus YELLOW approves, stores variance and flag-only wastage", async () => {
    const order = await createPending(ctx, { actualFabricYds: "95.00" });
    const extra = order.items[0];
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order, { [extra.componentId]: extra.expectedQty + 2 }));
    const response = await approveRequest(order.id, ctx.users.verifier.id, {});
    expect(response.status).toBe(200);
    const approved = await responseOrder(response);
    expect(approved.status).toBe("VERIFIED");
    const attempt = approved.attempts[0];
    expect(attempt.items.find((item) => item.componentId === extra.componentId)?.variance).toBe(2);
    expect(attempt.decision?.snapshot).toMatchObject({ expectedFabricYds: "90.00", actualFabricYds: "95.00", wastagePct: "5.56", overCap: true });
    const [view] = await prisma.$queryRaw<{ variance: number }[]>`SELECT variance FROM verification_variances WHERE order_id = ${order.id} AND component_id = ${extra.componentId}`;
    expect(view.variance).toBe(2);
  });

  it("V29 and V30: no session is 401, unknown is 404, sequential replay is 409", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    expect((await approveRequest(order.id, null)).status).toBe(401);
    expect((await approveRequest(randomUUID(), ctx.users.verifier.id)).status).toBe(404);
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(200);
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(409);
    expect(await prisma.verificationLog.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("V34: rejected, verified and in-sewing orders return 409 before business rules", async () => {
    const rejected = await createPending(ctx);
    await rejectRequest(rejected.id, ctx.users.verifier.id, { note: "Defect" });
    expect((await approveRequest(rejected.id, ctx.users.verifier.id)).status).toBe(409);

    const verified = await createPending(ctx);
    await saveCountsRequest(verified.id, ctx.users.verifier.id, countsFor(verified));
    await approveRequest(verified.id, ctx.users.verifier.id);
    expect((await approveRequest(verified.id, ctx.users.verifier.id)).status).toBe(409);

    await prisma.cuttingOrder.update({ where: { id: verified.id }, data: { status: "IN_SEWING", sewingStartedById: ctx.users.sewing.id, sewingStartedAt: new Date() } });
    expect((await approveRequest(verified.id, ctx.users.verifier.id)).status).toBe(409);
  });

  it("V36: the maximum accepted fabric value produces a storable large wastage", async () => {
    const order = await createPending(ctx, { targetQty: 1, actualFabricYds: "999999.99" });
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    const response = await approveRequest(order.id, ctx.users.verifier.id);
    expect(response.status).toBe(200);
    expect((await responseOrder(response)).attempts[0].decision?.snapshot?.overCap).toBe(true);
  });

  it("V38: unsupported order and log mutation methods are not exported", () => {
    for (const module of [orderByIdModule, approveModule, rejectModule]) {
      expect(module).not.toHaveProperty("PUT");
      expect(module).not.toHaveProperty("PATCH");
      expect(module).not.toHaveProperty("DELETE");
    }
  });
});

describe("reject and resubmit", () => {
  it("V40: rejects every invalid note shape", async () => {
    const order = await createPending(ctx);
    for (const note of [undefined, "", "   ", "\n\t", null, 7, "x".repeat(1_001), "bad\u0000note"]) {
      const body = note === undefined ? {} : { note };
      const response = await rejectRequest(order.id, ctx.users.verifier.id, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.fields.note).toEqual(expect.any(String));
    }
  });

  it("V41, V42, V45 and V46: valid plain-text note rejects regardless of counts and freezes evidence", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    const note = "  <b>Visible defect</b>  ";
    const response = await rejectRequest(order.id, ctx.users.verifier.id, { note });
    expect(response.status).toBe(200);
    const rejected = await responseOrder(response);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.attempts[0].decision).toMatchObject({ decision: "REJECTED", rejectionNote: "<b>Visible defect</b>", snapshot: null });
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order))).status).toBe(409);
  });

  it("V43 and V44: auth, roles and state are enforced", async () => {
    const order = await createPending(ctx);
    expect((await rejectRequest(order.id, null, { note: "x" })).status).toBe(401);
    expect((await rejectRequest(order.id, ctx.users.supervisor.id, { note: "x" })).status).toBe(403);
    expect((await rejectRequest(order.id, ctx.users.sewing.id, { note: "x" })).status).toBe(403);
    expect((await rejectRequest(order.id, ctx.users.verifier.id, { note: "x" })).status).toBe(200);
    expect((await rejectRequest(order.id, ctx.users.verifier.id, { note: "again" })).status).toBe(409);
  });

  it("V50, V53 and V55: any supervisor can resubmit and attempt history survives a second approval", async () => {
    const order = await createPending(ctx);
    await rejectRequest(order.id, ctx.users.verifier.id, { note: "Re-cut cuffs" });
    const secondSupervisor = await prisma.user.create({
      data: { email: "second-sup@test.local", passwordHash: "x", role: "cutting_supervisor", fullName: "Second Supervisor" },
    });
    const response = await resubmitRequest(order.id, secondSupervisor.id, {});
    expect(response.status).toBe(200);
    const resubmitted = await responseOrder(response);
    expect(resubmitted).toMatchObject({ status: "PENDING_VERIFICATION", currentAttempt: 2, actualFabricYds: order.actualFabricYds });
    expect(resubmitted.attempts).toHaveLength(2);
    expect(resubmitted.attempts[1].items.every((item) => item.actualQty === null && item.status === null)).toBe(true);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(resubmitted));
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(200);
    expect(await prisma.verificationLog.count({ where: { orderId: order.id } })).toBe(2);
  });

  it("V51 and V54: roles, state and strict body fields are enforced", async () => {
    const pending = await createPending(ctx);
    expect((await resubmitRequest(pending.id, ctx.users.supervisor.id)).status).toBe(409);
    await rejectRequest(pending.id, ctx.users.verifier.id, { note: "Defect" });
    expect((await resubmitRequest(pending.id, ctx.users.verifier.id)).status).toBe(403);
    expect((await resubmitRequest(pending.id, ctx.users.sewing.id)).status).toBe(403);
    for (const key of ["status", "currentAttempt", "actualFabricYds"]) {
      expect((await resubmitRequest(pending.id, ctx.users.supervisor.id, { [key]: "forged" })).status).toBe(400);
    }
  });
});

describe("role-scoped reads and serialization", () => {
  it("V60: verifier list is pending-only oldest first and rejects another status", async () => {
    const first = await createPending(ctx);
    const second = await createPending(ctx);
    await rejectRequest(second.id, ctx.users.verifier.id, { note: "Defect" });
    const response = await listOrdersRequest(ctx.users.verifier.id);
    expect(response.status).toBe(200);
    const orders = (await response.json()).data.orders;
    expect(orders.map((order: { id: string }) => order.id)).toEqual([first.id]);
    expect((await listOrdersRequest(ctx.users.verifier.id, "?status=VERIFIED")).status).toBe(403);
  });

  it("V61 and V63: verifier gets pending detail with projection, non-pending is hidden, DTO is safe", async () => {
    const order = await createPending(ctx);
    const pending = await getOrderRequest(order.id, ctx.users.verifier.id);
    expect(pending.status).toBe(200);
    const text = await pending.text();
    const detail = JSON.parse(text).data.order;
    expect(detail.fabricProjection).toMatchObject({ expectedFabricYds: "90.00", actualFabricYds: "91.00" });
    expect(detail.actualFabricYds).toBe("91.00");
    expect(text).not.toMatch(/passwordHash|tokenHash|email/);
    await rejectRequest(order.id, ctx.users.verifier.id, { note: "Defect" });
    expect((await getOrderRequest(order.id, ctx.users.verifier.id)).status).toBe(404);
  });

  it("V62: supervisor detail exposes rejection history and shortage variance", async () => {
    const order = await createPending(ctx);
    const short = order.items[0];
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order, { [short.componentId]: short.expectedQty - 2 }));
    await rejectRequest(order.id, ctx.users.verifier.id, { note: "Two pieces short" });
    const detail = await responseOrder(await getOrderRequest(order.id, ctx.users.supervisor.id));
    expect(detail.attempts[0].decision).toMatchObject({ decision: "REJECTED", rejectionNote: "Two pieces short" });
    expect(detail.attempts[0].items.find((item) => item.componentId === short.componentId)?.variance).toBe(-2);
  });

  it("V64: sewing supervisor gets 403 on every Day 3 endpoint", async () => {
    const order = await createPending(ctx);
    const requests = [
      saveCountsRequest(order.id, ctx.users.sewing.id, countsFor(order)),
      approveRequest(order.id, ctx.users.sewing.id),
      rejectRequest(order.id, ctx.users.sewing.id, { note: "x" }),
      resubmitRequest(order.id, ctx.users.sewing.id),
      listOrdersRequest(ctx.users.sewing.id),
      getOrderRequest(order.id, ctx.users.sewing.id),
    ];
    expect((await Promise.all(requests)).map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
  });

  it("only the specified action methods exist", () => {
    expect(Object.keys(countsModule).sort()).toEqual(["PUT"]);
    expect(Object.keys(approveModule).sort()).toEqual(["POST"]);
    expect(Object.keys(rejectModule).sort()).toEqual(["POST"]);
    expect(Object.keys(resubmitModule).sort()).toEqual(["POST"]);
  });
});
