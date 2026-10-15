"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";
import type { SewingCardDto } from "@/lib/services/sewing-dto";
import { RecutBadge } from "./badges";
import { AlertIcon, ClockIcon, PlayIcon, RefreshIcon, SpinnerIcon } from "./icons";
import { OverCapBadge } from "./traffic-badge";

type Tab = "queue" | "active";
type Lists = { queue: SewingCardDto[]; active: SewingCardDto[] };

const TABS: { key: Tab; label: string }[] = [
  { key: "queue", label: "Ready for sewing" },
  { key: "active", label: "In sewing" },
];

export function SewingBoard({ initial, initialNow }: { initial: Lists; initialNow: string }) {
  const [lists, setLists] = useState(initial);
  const [tab, setTab] = useState<Tab>("queue");
  const [refreshedAt, setRefreshedAt] = useState(initialNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ queue: null, active: null });

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [queue, active] = await Promise.all([
        apiFetch<{ orders: SewingCardDto[] }>("/api/sewing/queue?limit=100"),
        apiFetch<{ orders: SewingCardDto[] }>("/api/sewing/active?limit=100"),
      ]);
      setLists({ queue: queue.orders, active: active.orders });
      setRefreshedAt(new Date().toISOString());
      setAnnouncement(`Lists updated: ${queue.orders.length} ready for sewing, ${active.orders.length} in sewing.`);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The lists could not be refreshed");
    } finally {
      setBusy(false);
    }
  }

  function onTabKey(event: React.KeyboardEvent, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    const next = TABS[target].key;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const orders = lists[tab];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-slate-900 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-600">Assembly line</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Sewing Queue</h1>
          <p className="mt-1 text-slate-700">Only batches a verifier has signed off appear here. Oldest approval first.</p>
        </div>
        <button type="button" className="btn btn-secondary min-h-12" onClick={refresh} disabled={busy}>
          {busy ? <SpinnerIcon /> : <RefreshIcon />}
          {busy ? "Refreshing..." : "Refresh lists"}
        </button>
      </header>

      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-50 p-3 font-semibold text-red-950" role="alert">
          <AlertIcon />
          {error}
        </p>
      )}

      <p role="status" className="sr-only">{announcement}</p>

      <div role="tablist" aria-label="Sewing lists" className="flex flex-wrap gap-2">
        {TABS.map(({ key, label }, index) => {
          const selected = tab === key;
          return (
            <button
              key={key}
              ref={(element) => void (tabRefs.current[key] = element)}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={selected}
              aria-controls={`panel-${key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={`inline-flex min-h-12 items-center gap-2 rounded-lg border-2 px-4 font-bold ${
                selected ? "border-blue-800 bg-blue-800 text-white" : "border-slate-500 bg-white text-slate-900 hover:bg-slate-100"
              }`}
            >
              {label}
              <span className={`rounded-full px-2 py-0.5 text-sm ${selected ? "bg-white text-blue-950" : "bg-slate-200 text-slate-950"}`}>{lists[key].length}<span className="sr-only"> batches</span></span>
            </button>
          );
        })}
      </div>

      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4">
        {orders.length === 0 ? (
          <div className="card border-dashed p-10 text-center">
            <ClockIcon className="mx-auto text-4xl text-slate-600" />
            <h2 className="mt-3 text-xl font-bold text-slate-950">{tab === "queue" ? "No verified batches waiting" : "Nothing is in sewing yet"}</h2>
            <p className="mt-1 text-slate-700">Last refreshed {formatDateTime(refreshedAt)}.</p>
            <button type="button" className="btn btn-secondary mt-4 min-h-12" onClick={refresh} disabled={busy}>
              Refresh
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              Last refreshed {formatDateTime(refreshedAt)}
              {orders.length >= 100 && ". Showing the first 100 batches."}
            </p>
            <ol className="grid gap-4 md:grid-cols-2" aria-label={tab === "queue" ? "Batches ready for sewing" : "Batches in sewing"}>
              {orders.map((order) => (
                <li key={order.id}>
                  <SewingCard order={order} />
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function SewingCard({ order }: { order: SewingCardDto }) {
  const started = order.status === "IN_SEWING";
  return (
    <Link
      href={`/sewing/${order.id}`}
      className="group block min-h-12 rounded-xl border border-slate-500 bg-white p-5 text-slate-950 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-blue-800 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-mono text-2xl font-black text-blue-900 group-hover:underline">{order.orderNo}</h2>
        <div className="flex flex-wrap justify-end gap-2">
          {order.attemptNo > 1 && <RecutBadge attemptNo={order.attemptNo} />}
          {order.approval.overCap && <OverCapBadge />}
        </div>
      </div>
      <p className="mt-2 text-lg font-bold">{order.recipe.name}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-slate-600">Target</dt>
          <dd className="font-mono text-lg font-bold">{order.targetQty.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Wastage</dt>
          <dd className="font-mono text-lg font-bold">
            {order.approval.wastagePct}% <span className="text-sm font-semibold text-slate-700">of {order.approval.wastageCapPct}% cap</span>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="sr-only">Verified</dt>
          <dd className="font-semibold text-slate-900">
            Verified by {order.approval.verifier.fullName} <span className="text-slate-700">· {formatDateTime(order.approval.decidedAt)}</span>
          </dd>
        </div>
        {started && order.sewingStartedBy && order.sewingStartedAt && (
          <div className="col-span-2">
            <dt className="sr-only">Started</dt>
            <dd className="flex items-center gap-1.5 font-semibold text-indigo-950">
              <PlayIcon />
              Started by {order.sewingStartedBy.fullName} · {formatDateTime(order.sewingStartedAt)}
            </dd>
          </div>
        )}
      </dl>
    </Link>
  );
}
