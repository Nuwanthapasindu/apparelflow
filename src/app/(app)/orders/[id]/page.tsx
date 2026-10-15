import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/badges";
import { ExpectedCountsTable } from "@/components/expected-counts-table";
import { RoleGate } from "@/components/role-gate";
import { ResubmitButton } from "@/components/resubmit-button";
import { OverCapBadge, TrafficBadge } from "@/components/traffic-badge";
import { getSessionUser } from "@/lib/auth/server";
import { formatDateTime, formatInt } from "@/lib/format";
import { getOrder } from "@/lib/services/orders";

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 font-medium text-slate-900" role="status">Loading order...</p>}>
      <OrderContent params={params} />
    </Suspense>
  );
}

async function OrderContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RoleGate path={`/orders/${encodeURIComponent(id)}`} roles={["cutting_supervisor"]} area="Cutting Orders">
      <OrderDetail id={id} />
    </RoleGate>
  );
}

async function OrderDetail({ id }: { id: string }) {
  const user = await getSessionUser();
  if (!user) return null; // RoleGate has already redirected a signed-out visitor
  const order = await getOrder(user, id);
  if (!order) notFound();

  const facts: [string, string][] = [
    ["Recipe", `${order.recipe.recipeCode} - ${order.recipe.name}`],
    ["Target quantity", `${formatInt(order.targetQty)} garments`],
    ["Fabric roll", order.fabricRollId],
    ["Fabric used", `${order.actualFabricYds} yds`],
    ["Attempt", String(order.currentAttempt)],
    ["Created by", order.createdBy.fullName],
    ["Created", formatDateTime(order.createdAt)],
  ];
  const currentItems = order.attempts.find((attempt) => attempt.attemptNo === order.currentAttempt)?.items ?? [];
  const currentAttempt = order.attempts.find((attempt) => attempt.attemptNo === order.currentAttempt);
  const rejection = order.status === "REJECTED" && currentAttempt?.decision?.decision === "REJECTED" ? currentAttempt : null;

  return (
    <div className="space-y-5">
      <Link href="/orders" className="inline-flex min-h-11 items-center font-semibold">
        &larr; Back to orders
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="order-heading" tabIndex={-1} className="font-mono text-2xl font-bold text-slate-900 outline-none">{order.orderNo}</h1>
        <StatusBadge status={order.status} />
      </div>

      <section className="card p-5" aria-labelledby="facts">
        <h2 id="facts" className="sr-only">
          Order details
        </h2>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-slate-700">{label}</dt>
              <dd className="font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card max-w-xl p-5" aria-labelledby="expected">
        <h2 id="expected" className="text-lg font-bold text-slate-900">
          Expected pieces to be counted
        </h2>
        <div className="mt-2">
          <ExpectedCountsTable rows={currentItems} caption={`Expected pieces per component, attempt ${order.currentAttempt}`} />
        </div>
      </section>

      {rejection && (
        <section className="rounded-xl border-2 border-red-700 bg-red-50 p-5 text-red-950" aria-labelledby="rejection-details">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="rejection-details" className="text-xl font-black">Re-cut required</h2>
              <p className="mt-1 text-sm">Rejected by {rejection.decision?.verifier.fullName} · {formatDateTime(rejection.decision!.decidedAt)}</p>
            </div>
            <ResubmitButton orderId={order.id} orderNo={order.orderNo} />
          </div>
          <div className="mt-4 rounded-lg border border-red-300 bg-white p-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-red-900">Verifier note</h3>
            <p className="mt-1 whitespace-pre-wrap text-slate-950">{rejection.decision?.rejectionNote}</p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-red-300 bg-white">
            <table className="w-full text-left">
              <caption className="sr-only">Rejected attempt component counts</caption>
              <thead><tr className="border-b border-slate-400 bg-slate-100"><th className="p-3">Component</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Actual</th><th className="p-3 text-right">Variance</th><th className="p-3">Result</th></tr></thead>
              <tbody>{rejection.items.map((item) => <tr key={item.componentId} className={item.variance !== null && item.variance < 0 ? "border-b border-red-200 bg-red-50" : "border-b border-slate-200"}><th className="p-3 font-semibold">{item.componentName}</th><td className="p-3 text-right font-mono">{item.expectedQty}</td><td className="p-3 text-right font-mono">{item.actualQty ?? "—"}</td><td className="p-3 text-right font-mono font-bold">{item.variance === null ? "—" : item.variance > 0 ? `+${item.variance}` : item.variance}</td><td className="p-3"><TrafficBadge status={item.status} /></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="attempt-history">
        <h2 id="attempt-history" className="text-xl font-black text-slate-950">Attempt history</h2>
        {order.attempts.map((attempt) => (
          <article key={attempt.attemptNo} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-slate-950">Attempt {attempt.attemptNo}</h3>
              <p className="font-semibold text-slate-800">
                {attempt.decision ? `${attempt.decision.decision === "APPROVED" ? "Approved" : "Rejected"} · ${formatDateTime(attempt.decision.decidedAt)}` : "Awaiting verifier decision"}
              </p>
            </div>
            {attempt.decision?.rejectionNote && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-300 bg-slate-50 p-3 text-slate-900">{attempt.decision.rejectionNote}</p>}
            {attempt.decision?.snapshot && (
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div><dt className="text-sm text-slate-600">Expected fabric</dt><dd className="font-mono font-bold">{attempt.decision.snapshot.expectedFabricYds} yds</dd></div>
                <div><dt className="text-sm text-slate-600">Actual fabric</dt><dd className="font-mono font-bold">{attempt.decision.snapshot.actualFabricYds} yds</dd></div>
                <div><dt className="text-sm text-slate-600">Wastage</dt><dd className="flex flex-wrap items-center gap-2 font-mono font-bold">{attempt.decision.snapshot.wastagePct}%{attempt.decision.snapshot.overCap && <OverCapBadge />}</dd></div>
              </dl>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
