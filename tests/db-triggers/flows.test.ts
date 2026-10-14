import { beforeEach, describe, expect, it } from "vitest";
import {
  approve,
  countItems,
  createOrder,
  OVER_CAP_SNAPSHOT,
  prisma,
  reject,
  resetDb,
  resubmit,
  seedBase,
  startSewing,
} from "../helpers/db";

beforeEach(seedBase);

describe("happy path", () => {
  it("20: all GREEN plus one YELLOW approves over cap, becomes VERIFIED, then IN_SEWING", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 101 }); // cuffs expect 100: excess is YELLOW
    const cuffs = await prisma.verificationItem.findFirstOrThrow({ where: { componentId: "c5" } });
    expect(cuffs.status).toBe("YELLOW");

    await approve("o1", 1); // over_cap = true must NOT block approval

    const log = await prisma.verificationLog.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId: "o1", attemptNo: 1 } } });
    expect(log.decision).toBe("APPROVED");
    expect(log.overCap).toBe(OVER_CAP_SNAPSHOT.overCap);
    expect(log.wastagePct?.toString()).toBe("5.56");
    expect(log.verifierId).toBe("u_ver");
    expect((await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } })).status).toBe("VERIFIED");

    await startSewing("o1");
    const order = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } });
    expect(order.status).toBe("IN_SEWING");
    expect(order.sewingStartedById).toBe("u_sew");
    expect(order.sewingStartedAt).toBeInstanceOf(Date);
  });

  it("20: only the VERIFIED order shows up in a status = 'VERIFIED' queue query", async () => {
    await createOrder("pending");
    await createOrder("verified");
    await countItems("verified", 1);
    await approve("verified");
    const queue = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM cutting_orders WHERE status = 'VERIFIED'`;
    expect(queue.map((o) => o.id)).toEqual(["verified"]);
  });
});

describe("reject and resubmit", () => {
  it("21: reject, resubmit with +1, approve attempt 2; attempt-1 rows are untouched", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 99 });
    await reject("o1", 1);

    const attempt1Items = await prisma.verificationItem.findMany({ where: { orderId: "o1", attemptNo: 1 }, orderBy: { componentId: "asc" } });
    const attempt1Log = await prisma.verificationLog.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId: "o1", attemptNo: 1 } } });

    expect(await resubmit("o1")).toBe(2);
    await countItems("o1", 2);
    await approve("o1", 2);

    const order = await prisma.cuttingOrder.findUniqueOrThrow({ where: { id: "o1" } });
    expect(order.status).toBe("VERIFIED");
    expect(order.currentAttempt).toBe(2);

    expect(await prisma.verificationItem.findMany({ where: { orderId: "o1", attemptNo: 1 }, orderBy: { componentId: "asc" } })).toEqual(attempt1Items);
    expect(attempt1Items.find((i) => i.componentId === "c5")?.status).toBe("RED");
    expect(await prisma.verificationLog.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId: "o1", attemptNo: 1 } } })).toEqual(attempt1Log);
    expect(await prisma.verificationLog.count({ where: { orderId: "o1" } })).toBe(2);
    expect(await prisma.verificationItem.count({ where: { orderId: "o1", attemptNo: 2 } })).toBe(5);
  });
});

describe("variance view", () => {
  it("22: returns actual - expected per component (5 rows for the blouse order)", async () => {
    await createOrder("o1");
    await countItems("o1", 1, { c5: 99, c1: 52 });
    const rows = await prisma.$queryRaw<{ component_id: string; variance: number }[]>`
      SELECT component_id, variance FROM verification_variances
      WHERE order_id = 'o1' AND attempt_no = 1 ORDER BY component_id`;
    expect(rows).toHaveLength(5);
    expect(Object.fromEntries(rows.map((r) => [r.component_id, r.variance]))).toEqual({
      c1: 2, // 52 - 50
      c2: 0,
      c3: 0,
      c4: 0,
      c5: -1, // 99 - 100: shortage is negative
    });
  });

  it("22: variance is NULL while an item is uncounted", async () => {
    await createOrder("o1");
    const rows = await prisma.$queryRaw<{ variance: number | null }[]>`SELECT variance FROM verification_variances WHERE order_id = 'o1'`;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.variance === null)).toBe(true);
  });
});

describe("cleanup", () => {
  it("23: TRUNCATE ... CASCADE succeeds on populated tables, including the append-only log", async () => {
    await createOrder("o1");
    await countItems("o1", 1);
    await approve("o1");
    expect(await prisma.verificationLog.count()).toBe(1);

    await resetDb();

    for (const count of await Promise.all([
      prisma.user.count(),
      prisma.recipe.count(),
      prisma.recipeComponent.count(),
      prisma.cuttingOrder.count(),
      prisma.verificationItem.count(),
      prisma.verificationLog.count(),
    ])) {
      expect(count).toBe(0);
    }
  });
});
