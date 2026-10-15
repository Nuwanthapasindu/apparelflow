import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { listSewingQueue } from "@/lib/services/sewing-queue";
import { prisma } from "../helpers/db";
import { createOneOfEachStatus } from "../helpers/sewing";
import {
  approveRequest,
  countsFor,
  createPending,
  rejectRequest,
  saveCountsRequest,
  setupVerification,
  type VerificationContext,
} from "../helpers/verification";

let ctx: VerificationContext;
beforeEach(async () => {
  ctx = await setupVerification();
});

describe("brief-required verifier gatekeeper tests", () => {
  it("Test 1: all GREEN components can be approved by an authenticated Verifier", async () => {
    const order = await createPending(ctx, { actualFabricYds: "94.50" });
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order))).status).toBe(200);

    const response = await approveRequest(order.id, ctx.users.verifier.id);
    expect(response.status).toBe(200);
    const approved = (await response.json()).data.order;
    expect(approved.status).toBe("VERIFIED");
    const log = await prisma.verificationLog.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId: order.id, attemptNo: 1 } } });
    expect(log).toMatchObject({ decision: "APPROVED", verifierId: ctx.users.verifier.id, wastagePct: expect.anything(), overCap: false });
    expect(log.decidedAt).toBeInstanceOf(Date);
  });

  it("Test 2: one RED component blocks approval with 422", async () => {
    const order = await createPending(ctx);
    const short = order.items[0];
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order, { [short.componentId]: short.expectedQty - 1 }))).status).toBe(200);

    const response = await approveRequest(order.id, ctx.users.verifier.id, {});
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.details.blocking).toContainEqual(expect.objectContaining({ componentId: short.componentId, reason: "SHORTAGE" }));
    expect(await prisma.verificationLog.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_VERIFICATION");
  });

  it("Test 3: rejecting without a valid reason is rejected by backend validation", async () => {
    const order = await createPending(ctx);
    for (const body of [{}, { note: "" }, { note: "   " }, { note: "\n\t" }, { note: null }, { note: 5 }]) {
      const response = await rejectRequest(order.id, ctx.users.verifier.id, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.fields.note).toEqual(expect.any(String));
    }
    expect(await prisma.verificationLog.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("Test 4: non-verifier roles receive 403 when attempting approval", async () => {
    const order = await createPending(ctx);
    for (const userId of [ctx.users.supervisor.id, ctx.users.sewing.id]) {
      expect((await approveRequest(order.id, userId)).status).toBe(403);
      expect((await approveRequest(randomUUID(), userId)).status).toBe(403);
    }
    expect(await prisma.verificationLog.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("Test 5: unapproved orders never appear in the Sewing Queue database query", async () => {
    const { pending, rejected, verified, inSewing } = await createOneOfEachStatus(ctx);
    // The shipped query itself, called directly against the database (no endpoint, no session).
    const queue = await listSewingQueue({ limit: 100 });
    expect(queue.map((o) => o.id)).toEqual([verified.id]);
    for (const absent of [pending.id, rejected.id, inSewing.id]) {
      expect(queue.some((o) => o.id === absent)).toBe(false);
    }
    expect(await prisma.cuttingOrder.count()).toBe(4);
  });
});
