"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiFetch, hardNavigate } from "@/lib/client/api";
import { evaluateCount } from "@/lib/domain/traffic-light";
import { formatDateTime, formatInt } from "@/lib/format";
import type { OrderDetailDto, OrderItemDto } from "@/lib/services/order-dto";
import { parseActualQtyText, REJECTION_NOTE_MAX } from "@/lib/validation/verification";
import { AlertIcon, CheckCircleIcon, SpinnerIcon, XCircleIcon } from "./icons";
import { OverCapBadge, TrafficBadge } from "./traffic-badge";

type BlockingItem = {
  componentId: string;
  componentName: string;
  expectedQty: number;
  actualQty: number | null;
  reason: "MISSING" | "UNCOUNTED" | "SHORTAGE";
};

const valueMap = (items: OrderItemDto[]) =>
  Object.fromEntries(items.map((item) => [item.componentId, item.actualQty === null ? "" : String(item.actualQty)]));

function useNativeDialog(open: boolean, dialog: React.RefObject<HTMLDialogElement | null>, focus?: string) {
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      if (focus) queueMicrotask(() => element.querySelector<HTMLElement>(focus)?.focus());
    } else if (!open && element.open) element.close();
  }, [dialog, focus, open]);
}

export function VerificationWorkspace({ initialOrder }: { initialOrder: OrderDetailDto }) {
  const [order, setOrder] = useState(initialOrder);
  const [values, setValues] = useState<Record<string, string>>(() => valueMap(initialOrder.items));
  const [savedValues, setSavedValues] = useState<Record<string, string>>(() => valueMap(initialOrder.items));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<BlockingItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const approveDialog = useRef<HTMLDialogElement>(null);
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const approveTrigger = useRef<HTMLButtonElement>(null);
  const rejectTrigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);

  useNativeDialog(approveOpen, approveDialog, "[data-autofocus]");
  useNativeDialog(rejectOpen, rejectDialog, "textarea");

  const evaluated = useMemo(
    () =>
      order.items.map((item) => {
        const text = values[item.componentId] ?? "";
        if (text === "") return { item, text, status: null, actual: null, error: null };
        const parsed = parseActualQtyText(text);
        if ("error" in parsed) return { item, text, status: null, actual: null, error: parsed.error };
        return { item, text, status: evaluateCount(item.expectedQty, parsed.value), actual: parsed.value, error: null };
      }),
    [order.items, values],
  );
  const dirty = order.items.some((item) => (values[item.componentId] ?? "") !== (savedValues[item.componentId] ?? ""));
  const invalid = evaluated.filter((row) => row.error).length;
  const counts = {
    GREEN: evaluated.filter((row) => row.status === "GREEN").length,
    YELLOW: evaluated.filter((row) => row.status === "YELLOW").length,
    RED: evaluated.filter((row) => row.status === "RED").length,
    UNCOUNTED: evaluated.filter((row) => row.text === "" || row.error).length,
  };
  const canApprove = counts.RED === 0 && counts.UNCOUNTED === 0 && !dirty && !saving && !deciding;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function replaceOrder(next: OrderDetailDto, saved = true) {
    setOrder(next);
    const nextValues = valueMap(next.items);
    setValues(nextValues);
    if (saved) setSavedValues(nextValues);
  }

  async function reload() {
    const payload = await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${order.id}`);
    replaceOrder(payload.order);
  }

  function conflict() {
    hardNavigate(`/verify?result=conflict&order=${encodeURIComponent(order.orderNo)}`);
  }

  async function save() {
    if (inFlight.current) return;
    setBanner(null);
    setBlocking([]);
    const rows = evaluated.filter((row) => row.text !== "");
    if (invalid || rows.length === 0) {
      setBanner(invalid ? "Correct the highlighted counts before saving." : "Enter at least one component count before saving.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const payload = await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${order.id}/counts`, {
        method: "PUT",
        body: { counts: rows.map((row) => ({ componentId: row.item.componentId, actualQty: row.actual })) },
      });
      replaceOrder(payload.order);
      setSavedAt(new Date().toISOString());
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 409) conflict();
      else setBanner(cause instanceof ApiClientError ? cause.message : "Counts could not be saved");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function approve() {
    if (inFlight.current || !canApprove) return;
    inFlight.current = true;
    setDeciding(true);
    setBanner(null);
    try {
      await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${order.id}/approve`, { method: "POST", body: {} });
      hardNavigate(`/verify?result=verified&order=${encodeURIComponent(order.orderNo)}`);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 422) {
        const list = Array.isArray(cause.details?.blocking) ? (cause.details.blocking as BlockingItem[]) : [];
        setBlocking(list);
        setBanner("Approval is blocked by the stored server counts. Review the highlighted components.");
        setApproveOpen(false);
        await reload();
      } else if (cause instanceof ApiClientError && cause.status === 409) conflict();
      else setBanner(cause instanceof ApiClientError ? cause.message : "The batch could not be approved");
    } finally {
      inFlight.current = false;
      setDeciding(false);
    }
  }

  async function reject() {
    if (inFlight.current) return;
    const trimmed = note.trim();
    if (!trimmed || trimmed.length > REJECTION_NOTE_MAX || trimmed.includes("\u0000")) {
      setNoteError(!trimmed ? "Enter a rejection reason" : `Use ${REJECTION_NOTE_MAX} characters or fewer`);
      queueMicrotask(() => rejectDialog.current?.querySelector("textarea")?.focus());
      return;
    }
    inFlight.current = true;
    setDeciding(true);
    setNoteError(null);
    try {
      await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${order.id}/reject`, { method: "POST", body: { note: trimmed } });
      hardNavigate(`/verify?result=rejected&order=${encodeURIComponent(order.orderNo)}`);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 409) conflict();
      else if (cause instanceof ApiClientError && cause.status === 400) setNoteError(cause.fields?.note ?? cause.message);
      else setBanner(cause instanceof ApiClientError ? cause.message : "The batch could not be rejected");
    } finally {
      inFlight.current = false;
      setDeciding(false);
    }
  }

  const blockReason = dirty
    ? "Approve blocked: save your latest count changes"
    : counts.RED || counts.UNCOUNTED
      ? `Approve blocked: ${counts.RED} short, ${counts.UNCOUNTED} not counted`
      : "All stored counts meet or exceed the expected quantities";
  const projection = order.fabricProjection;

  return (
    <div className="space-y-5 pb-28 md:pb-0">
      <Link href="/verify" className="inline-flex min-h-11 items-center font-semibold">&larr; Back to queue</Link>

      <header className="rounded-xl border-2 border-slate-800 bg-slate-950 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300">Verification workspace</p>
            <h1 className="mt-1 font-mono text-3xl font-black">{order.orderNo}</h1>
            <p className="mt-1 text-lg font-semibold text-slate-100">{order.recipe.recipeCode} · {order.recipe.name}</p>
          </div>
          <span className="rounded-full border border-blue-300 bg-blue-950 px-3 py-1.5 text-sm font-bold">Attempt {order.currentAttempt}</span>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-600 pt-4 sm:grid-cols-4">
          <div><dt className="text-xs uppercase tracking-wide text-slate-300">Target</dt><dd className="font-mono text-2xl font-black">{formatInt(order.targetQty)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-300">Fabric roll</dt><dd className="break-all font-mono font-bold">{order.fabricRollId}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-300">Components</dt><dd className="font-mono text-2xl font-black">{order.items.length}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-slate-300">Recorded fabric</dt><dd className="font-mono text-2xl font-black">{order.actualFabricYds}<span className="ml-1 text-sm">yds</span></dd></div>
        </dl>
      </header>

      {projection && (
        <section className="card grid gap-4 p-4 sm:grid-cols-4" aria-labelledby="fabric-projection">
          <div className="sm:col-span-4 flex flex-wrap items-center justify-between gap-2">
            <div><h2 id="fabric-projection" className="font-bold text-slate-950">Fabric projection</h2><p className="text-sm text-slate-700">Projection, recorded at approval. Over cap is a flag, not a blocker.</p></div>
            {projection.overCap && <OverCapBadge />}
          </div>
          {[['Expected', `${projection.expectedFabricYds} yds`], ['Used', `${projection.actualFabricYds} yds`], ['Projected wastage', `${projection.wastagePct}%`], ['Recipe cap', `${projection.wastageCapPct}%`]].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-100 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</dt><dd className="mt-1 font-mono text-lg font-black text-slate-950">{value}</dd></div>
          ))}
        </section>
      )}

      {(banner || counts.RED > 0 || blocking.length > 0) && (
        <section className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-950" role="alert">
          <h2 className="flex items-center gap-2 font-black"><AlertIcon />Shortage found. Approval is blocked.</h2>
          <p className="mt-1">{banner ?? "Reject the batch with a reason so the supervisor can re-cut."}</p>
          {blocking.length > 0 && <ul className="mt-2 list-disc pl-6">{blocking.map((item) => <li key={item.componentId}>{item.componentName}: {item.reason.toLowerCase()}</li>)}</ul>}
        </section>
      )}

      <section aria-labelledby="component-counts" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="component-counts" className="text-xl font-black text-slate-950">Component counts</h2><p className="text-slate-700">Enter actual pieces. Press Enter to move to the next row.</p></div>
          <p className={`rounded-full border px-3 py-1 text-sm font-bold ${dirty ? "border-amber-700 bg-amber-100 text-amber-950" : "border-green-700 bg-green-100 text-green-950"}`}>
            {dirty ? "Not saved" : savedAt ? "Saved" : "Stored counts loaded"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-500 bg-white p-3 text-center text-sm sm:grid-cols-4">
          <p><strong className="block text-xl text-green-900">{counts.GREEN}</strong>match</p>
          <p><strong className="block text-xl text-amber-950">{counts.YELLOW}</strong>excess</p>
          <p><strong className="block text-xl text-red-900">{counts.RED}</strong>short</p>
          <p><strong className="block text-xl text-slate-900">{counts.UNCOUNTED}</strong>not counted</p>
        </div>

        <div className="space-y-3">
          {evaluated.map((row, index) => {
            const variance = row.actual === null ? null : row.actual - row.item.expectedQty;
            const isRed = row.status === "RED" || blocking.some((item) => item.componentId === row.item.componentId);
            const errorId = `count-${row.item.componentId}-error`;
            return (
              <article key={row.item.componentId} className={`grid items-center gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[minmax(12rem,1.5fr)_8rem_10rem_7rem_9rem] ${isRed ? "border-red-700 border-l-8 bg-red-50" : "border-slate-400"}`}>
                <div><h3 className="font-bold text-slate-950">{row.item.componentName}</h3><p className="text-sm text-slate-600">Expected snapshot</p></div>
                <div><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Expected</p><p className="font-mono text-3xl font-black text-slate-950">{formatInt(row.item.expectedQty)}</p></div>
                <div>
                  <label htmlFor={`count-${row.item.componentId}`} className="field-label">Actual<span className="sr-only"> for {row.item.componentName}</span></label>
                  <input
                    ref={(element) => void (inputs.current[index] = element)}
                    id={`count-${row.item.componentId}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={row.text}
                    onChange={(event) => setValues((current) => ({ ...current, [row.item.componentId]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && inputs.current[index + 1]) { event.preventDefault(); inputs.current[index + 1]?.focus(); }
                    }}
                    aria-invalid={row.error ? true : undefined}
                    aria-describedby={row.error ? errorId : undefined}
                    className="min-h-12 font-mono text-xl font-bold"
                  />
                  {row.error && <p id={errorId} className="field-error"><AlertIcon />{row.error}</p>}
                </div>
                <div><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Variance</p><p className={`font-mono text-2xl font-black ${variance !== null && variance < 0 ? "text-red-900" : "text-slate-950"}`}>{variance === null ? "—" : variance > 0 ? `+${variance}` : variance}</p></div>
                <TrafficBadge status={row.status} />
              </article>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-500 bg-white p-4">
        <div><p id="approve-reason" className="font-semibold text-slate-900">{blockReason}</p>{savedAt && <p className="text-sm text-slate-600">Last saved this session at {formatDateTime(savedAt)}</p>}</div>
        <button type="button" className="btn btn-secondary min-h-12" onClick={save} disabled={saving || deciding || !dirty || invalid > 0}>
          {saving && <SpinnerIcon />}{saving ? "Saving..." : "Save counts"}
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-slate-400 bg-white p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] md:static md:justify-between md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <button ref={rejectTrigger} type="button" className="btn min-h-12 flex-1 border-2 border-red-700 bg-white text-red-900 hover:bg-red-50 md:flex-none" onClick={() => setRejectOpen(true)} disabled={deciding}>
          <XCircleIcon />Reject Batch
        </button>
        <button ref={approveTrigger} type="button" className="btn btn-primary min-h-12 flex-1 md:flex-none" disabled={!canApprove} aria-describedby="approve-reason" onClick={() => setApproveOpen(true)}>
          <CheckCircleIcon />Approve Batch
        </button>
      </div>

      <dialog ref={approveDialog} aria-labelledby="approve-title" onCancel={(event) => { event.preventDefault(); if (!deciding) setApproveOpen(false); }} className="m-auto w-[calc(100%-1rem)] max-w-lg rounded-xl border border-slate-500 bg-white p-0 text-slate-950 shadow-xl backdrop:bg-slate-950/65">
        {approveOpen && <div className="p-5"><h2 id="approve-title" className="text-xl font-black">Approve {order.orderNo}?</h2><p className="mt-2 text-slate-800">{counts.GREEN} match, {counts.YELLOW} excess. Projected wastage {projection?.wastagePct ?? "—"}%.</p>{projection?.overCap && <div className="mt-3"><OverCapBadge /></div>}<p className="mt-4 rounded-lg bg-slate-100 p-3 font-semibold">This sign-off is permanent and recorded under your name.</p><div className="mt-5 flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={() => { setApproveOpen(false); queueMicrotask(() => approveTrigger.current?.focus()); }} disabled={deciding}>Cancel</button><button data-autofocus type="button" className="btn btn-primary" onClick={approve} disabled={deciding}>{deciding && <SpinnerIcon />}{deciding ? "Approving..." : "Confirm approval"}</button></div></div>}
      </dialog>

      <dialog ref={rejectDialog} aria-labelledby="reject-title" onCancel={(event) => { event.preventDefault(); if (!deciding) setRejectOpen(false); }} className="m-auto w-[calc(100%-1rem)] max-w-lg rounded-xl border border-slate-500 bg-white p-0 text-slate-950 shadow-xl backdrop:bg-slate-950/65">
        {rejectOpen && <div className="p-5"><h2 id="reject-title" className="text-xl font-black">Reject {order.orderNo}</h2><p className="mt-1 text-slate-700">Tell the cutting supervisor exactly what must be re-cut.</p><label htmlFor="rejection-note" className="field-label mt-4">Rejection reason</label><textarea id="rejection-note" rows={5} maxLength={REJECTION_NOTE_MAX} value={note} onChange={(event) => { setNote(event.target.value); if (noteError) setNoteError(null); }} aria-invalid={noteError ? true : undefined} aria-describedby="note-counter rejection-note-error" disabled={deciding} />{noteError && <p id="rejection-note-error" className="field-error" role="alert"><AlertIcon />{noteError}</p>}<p id="note-counter" className="mt-1 text-right text-sm text-slate-700">{note.length} / {REJECTION_NOTE_MAX}</p><div className="mt-5 flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={() => { setRejectOpen(false); queueMicrotask(() => rejectTrigger.current?.focus()); }} disabled={deciding}>Cancel</button><button type="button" className="btn min-h-11 border-2 border-red-700 bg-red-700 text-white hover:bg-red-800" onClick={reject} disabled={deciding}>{deciding && <SpinnerIcon />}{deciding ? "Rejecting..." : "Confirm rejection"}</button></div></div>}
      </dialog>
    </div>
  );
}
