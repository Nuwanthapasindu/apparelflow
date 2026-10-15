import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../helpers/db";
import {
  approveRequest,
  countsFor,
  createPending,
  rejectRequest,
  resubmitRequest,
  saveCountsRequest,
  setupVerification,
  type VerificationContext,
} from "../helpers/verification";

let ctx: VerificationContext;
beforeEach(async () => {
  ctx = await setupVerification();
});

describe("verification decision concurrency", () => {
  it("V31: five concurrent approvals produce one 200, four 409s and one log", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    const responses = await Promise.all(Array.from({ length: 5 }, () => approveRequest(order.id, ctx.users.verifier.id)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await prisma.verificationLog.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("V32: concurrent approve and reject yield exactly one decision matching final state", async () => {
    const order = await createPending(ctx);
    await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    const responses = await Promise.all([
      approveRequest(order.id, ctx.users.verifier.id),
      rejectRequest(order.id, ctx.users.verifier.id, { note: "Visible defect" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const log = await prisma.verificationLog.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId: order.id, attemptNo: 1 } } });
    const stored = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe(log.decision === "APPROVED" ? "VERIFIED" : "REJECTED");
  });

  it("V33: counts-to-RED racing approval never leaves a verified shortage", async () => {
    for (let run = 0; run < 20; run += 1) {
      const order = await createPending(ctx, { fabricRollId: `RACE-${run}` });
      await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
      const short = order.items[0];
      const [countResponse, approveResponse] = await Promise.all([
        saveCountsRequest(order.id, ctx.users.verifier.id, {
          counts: [{ componentId: short.componentId, actualQty: short.expectedQty - 1 }],
        }),
        approveRequest(order.id, ctx.users.verifier.id),
      ]);
      const pair = [countResponse.status, approveResponse.status];
      expect(
        (pair[0] === 409 && pair[1] === 200) || (pair[0] === 200 && pair[1] === 422),
        `unexpected race result ${pair.join("/")}`,
      ).toBe(true);

      const stored = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (stored.status === "VERIFIED") {
        expect(
          await prisma.verificationItem.count({
            where: { orderId: order.id, attemptNo: stored.currentAttempt, OR: [{ actualQty: null }, { status: "RED" }] },
          }),
        ).toBe(0);
      }
    }
  });

  it("V52: two concurrent resubmits produce one 200, one 409 and attempt exactly 2", async () => {
    const order = await createPending(ctx);
    await rejectRequest(order.id, ctx.users.verifier.id, { note: "Re-cut" });
    const responses = await Promise.all([
      resubmitRequest(order.id, ctx.users.supervisor.id),
      resubmitRequest(order.id, ctx.users.supervisor.id),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.currentAttempt).toBe(2);
    expect(await prisma.verificationItem.count({ where: { orderId: order.id, attemptNo: 2 } })).toBe(5);
  });
});
