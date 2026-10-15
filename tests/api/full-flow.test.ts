import { beforeEach, describe, expect, it } from "vitest";
import * as ordersRoute from "@/app/api/orders/route";
import { as } from "../helpers/orders";
import { sewingActiveRequest, sewingDetailRequest, sewingQueueRequest, sewingStartRequest } from "../helpers/sewing";
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

let ctx: VerificationContext;
beforeEach(async () => {
  ctx = await setupVerification();
});

const ids = async (response: Response) => ((await response.json()).data.orders as { id: string }[]).map((o) => o.id);
const queue = async () => ids(await sewingQueueRequest(ctx.users.sewing.id));
const active = async () => ids(await sewingActiveRequest(ctx.users.sewing.id));
const statusOf = async (id: string) => (await (await getOrderRequest(id, ctx.users.supervisor.id)).json()).data.order.status as string;
const createOrder = async (overrides: Record<string, unknown> = {}) => {
  const response = await ordersRoute.POST(
    await as(ctx.users.supervisor.id, "POST", "/api/orders", {
      body: { recipeId: ctx.recipes.blouse.id, targetQty: 50, fabricRollId: "FLOW-ROLL", actualFabricYds: "91.00", ...overrides },
    }),
    undefined,
  );
  expect(response.status).toBe(201);
  return (await response.json()).data.order as Awaited<ReturnType<typeof import("../helpers/verification").createPending>>;
};

describe("full flow: the gatekeeper from creation to the sewing line", () => {
  it("supervisor creates, verifier counts and approves, sewing sees it, starts it, and it moves to active", async () => {
    const order = await createOrder();
    expect(order.status).toBe("PENDING_VERIFICATION");
    expect(await queue()).toEqual([]);
    expect((await ids(await listOrdersRequest(ctx.users.verifier.id))).includes(order.id)).toBe(true);

    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order))).status).toBe(200);
    expect(await queue()).toEqual([]); // counted is not verified

    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(200);
    expect(await statusOf(order.id)).toBe("VERIFIED");
    expect(await queue()).toEqual([order.id]);
    expect(await active()).toEqual([]);
    expect((await ids(await listOrdersRequest(ctx.users.verifier.id))).includes(order.id)).toBe(false); // left the verifier's queue

    const detail = (await (await sewingDetailRequest(order.id, ctx.users.sewing.id)).json()).data.order;
    expect(detail).toMatchObject({ status: "VERIFIED", attemptNo: 1, approval: { verifier: { fullName: "Cutting Verifier" }, wastagePct: "1.11", overCap: false } });

    const started = await sewingStartRequest(order.id, ctx.users.sewing.id);
    expect(started.status).toBe(200);
    expect(await statusOf(order.id)).toBe("IN_SEWING");
    expect(await queue()).toEqual([]);
    expect(await active()).toEqual([order.id]);
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id)).status).toBe(409);
  });

  it("a rejected or pending order is never in the queue at any step of the shortage, reject and resubmit loop", async () => {
    const order = await createOrder();
    const short = order.items[0];
    const note = "FLOW-NOTE-Back panel one piece short";

    // pending
    expect(await queue()).toEqual([]);
    // counted with a shortage: approval is blocked by the hard stop
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order, { [short.componentId]: short.expectedQty - 1 }))).status).toBe(200);
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(422);
    expect(await queue()).toEqual([]);
    // rejected
    expect((await rejectRequest(order.id, ctx.users.verifier.id, { note })).status).toBe(200);
    expect(await statusOf(order.id)).toBe("REJECTED");
    expect(await queue()).toEqual([]);
    expect((await sewingDetailRequest(order.id, ctx.users.sewing.id)).status).toBe(404);
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id)).status).toBe(404);
    // resubmitted: pending again, attempt 2, still not in the queue
    const resubmitted = await resubmitRequest(order.id, ctx.users.supervisor.id);
    expect(resubmitted.status).toBe(200);
    const attempt2 = (await resubmitted.json()).data.order;
    expect(attempt2).toMatchObject({ status: "PENDING_VERIFICATION", currentAttempt: 2 });
    expect(await queue()).toEqual([]);
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(422); // attempt 2 is uncounted
    // counted and approved: now, and only now, it is in the queue, as attempt 2 without the note
    expect((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(attempt2))).status).toBe(200);
    expect((await approveRequest(order.id, ctx.users.verifier.id)).status).toBe(200);
    expect(await queue()).toEqual([order.id]);

    const listText = await (await sewingQueueRequest(ctx.users.sewing.id)).text();
    const detailText = await (await sewingDetailRequest(order.id, ctx.users.sewing.id)).text();
    for (const text of [listText, detailText]) {
      expect(text).not.toContain(note);
      expect(text).toContain('"attemptNo":2');
    }
    expect((await sewingStartRequest(order.id, ctx.users.sewing.id)).status).toBe(200);
    expect(await active()).toEqual([order.id]);
  });

  it("two orders move independently: only the verified one is released", async () => {
    const [first, second] = [await createOrder({ fabricRollId: "FLOW-1" }), await createOrder({ fabricRollId: "FLOW-2" })];
    for (const order of [first, second]) await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order));
    expect((await approveRequest(second.id, ctx.users.verifier.id)).status).toBe(200);
    expect(await queue()).toEqual([second.id]);
    expect((await sewingStartRequest(first.id, ctx.users.sewing.id)).status).toBe(404); // first is still pending
    expect((await sewingStartRequest(second.id, ctx.users.sewing.id)).status).toBe(200);
    expect(await statusOf(first.id)).toBe("PENDING_VERIFICATION");
    expect(await active()).toEqual([second.id]);
  });
});
