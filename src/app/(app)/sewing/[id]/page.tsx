import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge, RecutBadge } from "@/components/badges";
import { RoleGate } from "@/components/role-gate";
import { StartSewingButton } from "@/components/start-sewing-button";
import { OverCapBadge, TrafficBadge } from "@/components/traffic-badge";
import { PlayIcon } from "@/components/icons";
import { getSessionUser } from "@/lib/auth/server";
import { formatDateTime, formatInt } from "@/lib/format";
import { getSewingOrder } from "@/lib/services/sewing";

export default function Page({ params }: PageProps<"/sewing/[id]">) {
  return (
    <Suspense fallback={<p className="card p-5 font-semibold text-slate-900" role="status">Loading batch...</p>}>
      <SewingDetailContent params={params} />
    </Suspense>
  );
}

async function SewingDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RoleGate path={`/sewing/${encodeURIComponent(id)}`} roles={["sewing_supervisor"]} area="the Sewing Queue">
      <SewingOrder id={id} />
    </RoleGate>
  );
}

async function SewingOrder({ id }: { id: string }) {
  const user = await getSessionUser();
  if (!user) return null;
  const order = await getSewingOrder(user, id);

  // Pending, rejected and unknown ids all land here: the sewing role cannot tell them apart.
  if (!order) {
    return (
      <section className="card mx-auto max-w-xl p-6" aria-labelledby="unavailable-title">
        <h1 id="unavailable-title" className="text-xl font-bold text-slate-900">This batch is not available</h1>
        <p className="mt-2 text-slate-800">It is not ready for sewing, or the link is out of date.</p>
        <Link href="/sewing" className="btn btn-primary mt-4 min-h-12 no-underline">
          Back to the sewing queue
        </Link>
      </section>
    );
  }

  const { approval } = order;
  const facts: [string, string][] = [
    ["Recipe", `${order.recipe.recipeCode} · ${order.recipe.name}`],
    ["Target quantity", `${formatInt(order.targetQty)} garments`],
    ["Fabric roll", order.fabricRollId],
  ];
  const audit: [string, string][] = [
    ["Verified by", approval.verifier.fullName],
    ["Verified at", formatDateTime(approval.decidedAt)],
    ["Expected fabric", `${approval.expectedFabricYds} yds`],
    ["Fabric used", `${approval.actualFabricYds} yds`],
    ["Wastage", `${approval.wastagePct}%`],
    ["Recipe cap", `${approval.wastageCapPct}%`],
  ];

  return (
    <div className="space-y-5">
      <Link href="/sewing" className="inline-flex min-h-11 items-center font-semibold">
        &larr; Back to the sewing queue
      </Link>

      <header className="rounded-xl border-2 border-slate-800 bg-slate-950 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300">Sewing batch</p>
            <h1 id="sewing-heading" tabIndex={-1} className="mt-1 font-mono text-3xl font-black outline-none">{order.orderNo}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {order.attemptNo > 1 && <RecutBadge attemptNo={order.attemptNo} />}
            <StatusBadge status={order.status} />
          </div>
        </div>
        <dl className="mt-5 grid gap-4 border-t border-slate-600 pt-4 sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-slate-300">{label}</dt>
              <dd className="break-all font-mono font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section className="card p-5" aria-labelledby="audit-trail">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="audit-trail" className="text-xl font-black text-slate-950">Audit trail</h2>
            <p className="text-sm text-slate-700">Recorded at verification. It cannot be changed.</p>
          </div>
          {approval.overCap && <OverCapBadge />}
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {audit.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-100 p-3">
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</dt>
              <dd className="mt-1 font-mono text-lg font-black text-slate-950">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-slate-700">
          Over cap is a flag, not a block: {approval.overCap ? "this batch used more fabric than the recipe cap allows." : "this batch is within the recipe cap."}
        </p>
      </section>

      <section aria-labelledby="counts-title" className="space-y-3">
        <h2 id="counts-title" className="text-xl font-black text-slate-950">Verified component counts</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-500 bg-white">
          <table className="w-full text-left">
            <caption className="sr-only">Component counts recorded by the verifier</caption>
            <thead>
              <tr className="border-b border-slate-400 bg-slate-100">
                <th scope="col" className="p-3">Component</th>
                <th scope="col" className="p-3 text-right">Expected</th>
                <th scope="col" className="p-3 text-right">Actual</th>
                <th scope="col" className="p-3 text-right">Variance</th>
                <th scope="col" className="p-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.componentName} className="border-b border-slate-200">
                  <th scope="row" className="p-3 font-semibold">{item.componentName}</th>
                  <td className="p-3 text-right font-mono">{formatInt(item.expectedQty)}</td>
                  <td className="p-3 text-right font-mono">{formatInt(item.actualQty)}</td>
                  <td className="p-3 text-right font-mono font-bold">{item.variance > 0 ? `+${item.variance}` : item.variance}</td>
                  <td className="p-3"><TrafficBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {order.status === "VERIFIED" ? (
        <section className="rounded-xl border border-slate-500 bg-white p-5" aria-labelledby="release-title">
          <h2 id="release-title" className="text-xl font-black text-slate-950">Release to the line</h2>
          <p className="mt-1 mb-4 text-slate-700">Every component was counted and signed off. Starting sewing is permanent.</p>
          <StartSewingButton orderId={order.id} orderNo={order.orderNo} />
        </section>
      ) : (
        <section className="rounded-xl border-2 border-indigo-700 bg-indigo-50 p-5 text-indigo-950" aria-labelledby="in-sewing-title">
          <h2 id="in-sewing-title" className="flex items-center gap-2 text-xl font-black">
            <PlayIcon />
            In sewing
          </h2>
          {order.sewingStartedBy && order.sewingStartedAt && (
            <p className="mt-1 font-semibold">
              Started by {order.sewingStartedBy.fullName} · {formatDateTime(order.sewingStartedAt)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
