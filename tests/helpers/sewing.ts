import * as activeRoute from "@/app/api/sewing/active/route";
import * as detailRoute from "@/app/api/sewing/[id]/route";
import * as startRoute from "@/app/api/sewing/[id]/start/route";
import * as queueRoute from "@/app/api/sewing/queue/route";
import { prisma } from "./db";
import { as } from "./orders";
import {
  approveRequest,
  countsFor,
  createPending,
  rejectRequest,
  resubmitRequest,
  saveCountsRequest,
  type VerificationContext,
} from "./verification";

type Pending = Awaited<ReturnType<typeof createPending>>;
type Overrides = Parameters<typeof createPending>[1];

export const sewingQueueRequest = async (userId: string | null, query = "") =>
  queueRoute.GET(await as(userId, "GET", `/api/sewing/queue${query}`), undefined);

export const sewingActiveRequest = async (userId: string | null, query = "") =>
  activeRoute.GET(await as(userId, "GET", `/api/sewing/active${query}`), undefined);

export const sewingDetailRequest = async (id: string, userId: string | null) =>
  detailRoute.GET(await as(userId, "GET", `/api/sewing/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });

export const sewingStartRequest = async (id: string, userId: string | null, body?: unknown, headers?: Record<string, string>) =>
  startRoute.POST(await as(userId, "POST", `/api/sewing/${encodeURIComponent(id)}/start`, { body, headers }), { params: Promise.resolve({ id }) });

/** An order that went through the real legal path: created, fully counted, approved. */
export async function createVerified(ctx: VerificationContext, overrides: Overrides = {}): Promise<Pending> {
  const order = await createPending(ctx, overrides);
  if ((await saveCountsRequest(order.id, ctx.users.verifier.id, countsFor(order))).status !== 200) throw new Error("fixture: counts failed");
  const approved = await approveRequest(order.id, ctx.users.verifier.id);
  if (approved.status !== 200) throw new Error(`fixture: approve failed (${approved.status})`);
  return order;
}

/** An order rejected by the verifier with a note (the legal path), left in REJECTED. */
export async function createRejected(ctx: VerificationContext, note = "Sleeve seam damaged", overrides: Overrides = {}): Promise<Pending> {
  const order = await createPending(ctx, overrides);
  if ((await rejectRequest(order.id, ctx.users.verifier.id, { note })).status !== 200) throw new Error("fixture: reject failed");
  return order;
}

/** Reject, resubmit, count and approve attempt 2. Returns the order and the secret rejection note. */
export async function createRecutAndVerified(ctx: VerificationContext, note = "SECRET-REJECTION-NOTE-7731") {
  const order = await createRejected(ctx, note);
  if ((await resubmitRequest(order.id, ctx.users.supervisor.id)).status !== 200) throw new Error("fixture: resubmit failed");
  const attempt2 = (await prisma.verificationItem.findMany({ where: { orderId: order.id, attemptNo: 2 } })).map((i) => ({
    componentId: i.componentId,
    actualQty: i.expectedQty,
  }));
  if ((await saveCountsRequest(order.id, ctx.users.verifier.id, { counts: attempt2 })).status !== 200) throw new Error("fixture: counts failed");
  if ((await approveRequest(order.id, ctx.users.verifier.id)).status !== 200) throw new Error("fixture: approve failed");
  return { order, note };
}

/** One order in each status. IN_SEWING is reached through the real start endpoint. */
export async function createOneOfEachStatus(ctx: VerificationContext) {
  const pending = await createPending(ctx);
  const rejected = await createRejected(ctx);
  const verified = await createVerified(ctx);
  const inSewing = await createVerified(ctx);
  const started = await sewingStartRequest(inSewing.id, ctx.users.sewing.id);
  if (started.status !== 200) throw new Error(`fixture: start failed (${started.status})`);
  return { pending, rejected, verified, inSewing };
}

/** Row counts and a fingerprint of every order, used to prove a refused request changed nothing. */
export async function snapshotState() {
  const [orders, items, logs, fingerprint] = await Promise.all([
    prisma.cuttingOrder.count(),
    prisma.verificationItem.count(),
    prisma.verificationLog.count(),
    prisma.$queryRaw<{ f: string }[]>`
      SELECT coalesce(string_agg(id || ':' || status::text || ':' || current_attempt::text || ':' || coalesce(sewing_started_by, '-') || ':' || coalesce(sewing_started_at::text, '-'), '|' ORDER BY id), '') AS f
      FROM cutting_orders`,
  ]);
  const itemFingerprint = await prisma.$queryRaw<{ f: string }[]>`
    SELECT coalesce(string_agg(id || ':' || coalesce(actual_qty::text, '-') || ':' || coalesce(status::text, '-'), '|' ORDER BY id), '') AS f
    FROM verification_items`;
  return { orders, items, logs, orderFingerprint: fingerprint[0].f, itemFingerprint: itemFingerprint[0].f };
}
