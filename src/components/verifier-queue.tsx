"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { formatDateTime, formatInt } from "@/lib/format";
import type { OrderListItemDto } from "@/lib/services/order-dto";
import { AlertIcon, CheckCircleIcon, ClockIcon, RefreshIcon, SpinnerIcon } from "./icons";

type QueuePayload = { orders: OrderListItemDto[]; hasMore: boolean };

function waitingSince(createdAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return "Just arrived";
  if (minutes < 60) return `${minutes} min waiting`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""} waiting`;
}

export function VerifierQueue({
  initialOrders,
  initialNow,
  result,
  orderNo,
}: {
  initialOrders: OrderListItemDto[];
  initialNow: string;
  result?: string;
  orderNo?: string;
}) {
  const initialTime = new Date(initialNow).getTime();
  const [orders, setOrders] = useState(initialOrders);
  const [now, setNow] = useState(initialTime);
  const [refreshedAt, setRefreshedAt] = useState(initialNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await apiFetch<QueuePayload>("/api/orders?status=PENDING_VERIFICATION&limit=100");
      setOrders(payload.orders);
      const timestamp = new Date().toISOString();
      setRefreshedAt(timestamp);
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The queue could not be refreshed");
    } finally {
      setBusy(false);
    }
  }

  const notice = result === "verified" || result === "rejected" ? `${orderNo ?? "Batch"} ${result}` : null;
  const conflict = result === "conflict" ? `${orderNo ?? "This batch"} was already decided or changed by someone else.` : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-slate-900 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-600">Quality control station</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Verifier Terminal</h1>
          <p className="mt-1 text-slate-700">Oldest batches first. Count every component before sign-off.</p>
        </div>
        <button type="button" className="btn btn-secondary min-h-12" onClick={refresh} disabled={busy}>
          {busy ? <SpinnerIcon /> : <RefreshIcon />}
          {busy ? "Refreshing..." : "Refresh queue"}
        </button>
      </header>

      {notice && (
        <p className="flex items-center gap-2 rounded-lg border border-green-700 bg-green-50 p-3 font-semibold text-green-950" role="status">
          <CheckCircleIcon />
          {notice}
        </p>
      )}
      {conflict && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-700 bg-amber-50 p-3 font-semibold text-amber-950" role="status">
          <AlertIcon />
          {conflict}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-50 p-3 font-semibold text-red-950" role="alert">
          <AlertIcon />
          {error}
        </p>
      )}

      {orders.length === 0 ? (
        <section className="card border-dashed p-10 text-center" aria-labelledby="empty-queue">
          <ClockIcon className="mx-auto text-4xl text-slate-600" />
          <h2 id="empty-queue" className="mt-3 text-xl font-bold text-slate-950">No batches waiting for verification</h2>
          <p className="mt-1 text-slate-700">Last refreshed {formatDateTime(refreshedAt)}.</p>
          <button type="button" className="btn btn-secondary mt-4 min-h-12" onClick={refresh} disabled={busy}>Refresh</button>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-slate-900">{formatInt(orders.length)} waiting</p>
            <p className="text-sm text-slate-700">Last refreshed {formatDateTime(refreshedAt)}</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-2" aria-label="Batches waiting for verification">
            {orders.map((order, index) => (
              <li key={order.id}>
                <Link
                  href={`/verify/${order.id}`}
                  className="group block min-h-44 rounded-xl border border-slate-500 bg-white p-5 text-slate-950 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-blue-800 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-600">Queue #{index + 1}</p>
                      <h2 className="mt-1 font-mono text-2xl font-black text-blue-900 group-hover:underline">{order.orderNo}</h2>
                    </div>
                    {order.currentAttempt > 1 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-700 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-950"><RefreshIcon />Re-cut #{order.currentAttempt}</span>
                    )}
                  </div>
                  <p className="mt-3 text-lg font-bold">{order.recipe.name}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div><dt className="text-slate-600">Target</dt><dd className="font-mono text-lg font-bold">{formatInt(order.targetQty)}</dd></div>
                    <div><dt className="text-slate-600">Fabric roll</dt><dd className="break-all font-mono font-semibold">{order.fabricRollId}</dd></div>
                    <div className="col-span-2"><dt className="sr-only">Waiting time</dt><dd className="flex items-center gap-1.5 font-semibold text-slate-800"><ClockIcon />{waitingSince(order.createdAt, now)}</dd></div>
                  </dl>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
