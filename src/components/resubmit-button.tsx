"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { OrderDetailDto } from "@/lib/services/order-dto";
import { AlertIcon, RefreshIcon, SpinnerIcon } from "./icons";

export function ResubmitButton({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const resubmitted = useRef(false);

  // The trigger disappears with the REJECTED panel once the refreshed page arrives; without this focus
  // would fall back to the document body, so keyboard and screen-reader users would lose their place.
  useEffect(
    () => () => {
      if (resubmitted.current) document.getElementById("order-heading")?.focus();
    },
    [],
  );

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  async function resubmit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ order: OrderDetailDto }>(`/api/orders/${orderId}/resubmit`, { method: "POST", body: {} });
      resubmitted.current = true;
      setOpen(false);
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 409) {
        setError("This order has already changed. Refresh the page to see its current status.");
      } else {
        setError(cause instanceof ApiClientError ? cause.message : "The order could not be resubmitted");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="btn btn-primary min-h-12" onClick={() => setOpen(true)}>
        <RefreshIcon />Resubmit for verification
      </button>
      <dialog ref={dialog} aria-labelledby="resubmit-title" onCancel={(event) => { event.preventDefault(); if (!busy) setOpen(false); }} className="m-auto w-[calc(100%-1rem)] max-w-lg rounded-xl border border-slate-500 bg-white p-0 text-slate-950 shadow-xl backdrop:bg-slate-950/65">
        {open && (
          <div className="p-5">
            <h2 id="resubmit-title" className="text-xl font-black">Resubmit {orderNo}?</h2>
            <p className="mt-3 rounded-lg border border-blue-700 bg-blue-50 p-3 font-semibold text-blue-950">I have re-cut the pieces and this batch is ready to be counted again.</p>
            <p className="mt-3 text-slate-700">A new uncounted attempt will be created. Earlier counts and the rejection note remain permanent.</p>
            {error && <p className="field-error mt-3 rounded-lg border border-red-700 bg-red-50 p-3" role="alert"><AlertIcon />{error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className="btn btn-secondary min-h-12" onClick={() => { setOpen(false); queueMicrotask(() => trigger.current?.focus()); }} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary min-h-12" onClick={resubmit} disabled={busy}>{busy && <SpinnerIcon />}{busy ? "Resubmitting..." : "Confirm resubmit"}</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
