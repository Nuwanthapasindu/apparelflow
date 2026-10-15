"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { SewingDetailDto } from "@/lib/services/sewing-dto";
import { AlertIcon, PlayIcon, SpinnerIcon } from "./icons";

export function StartSewingButton({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; final: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  // The button disappears once the page refreshes into IN_SEWING; keep focus on the page heading.
  useEffect(
    () => () => {
      if (started.current) document.getElementById("sewing-heading")?.focus();
    },
    [],
  );

  // Move focus to the message when it appears, so a keyboard or screen-reader user does not have to hunt for it.
  useEffect(() => {
    if (error) alertBox.current?.focus();
  }, [error]);

  async function start() {
    if (inFlight.current || error?.final) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ order: SewingDetailDto }>(`/api/sewing/${orderId}/start`, { method: "POST", body: {} });
      started.current = true;
      setOpen(false);
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 409) {
        setError({ message: "This batch has already been started by someone else.", final: true });
      } else if (cause instanceof ApiClientError && cause.status === 404) {
        setError({ message: "This batch is no longer available for sewing.", final: true });
      } else {
        setError({ message: cause instanceof ApiClientError ? cause.message : "Sewing could not be started. Try again.", final: false });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="btn btn-primary min-h-14 w-full text-lg sm:w-auto" onClick={() => { setError(null); setOpen(true); }}>
        <PlayIcon />
        Start Sewing Assembly
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="start-title"
        aria-describedby="start-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setOpen(false);
        }}
        className="m-auto w-[calc(100%-1rem)] max-w-lg rounded-xl border border-slate-500 bg-white p-0 text-slate-950 shadow-xl backdrop:bg-slate-950/65"
      >
        {open && (
          <div className="p-5">
            <h2 id="start-title" className="text-xl font-black">Start sewing {orderNo}?</h2>
            <p id="start-description" className="mt-3 rounded-lg border border-blue-700 bg-blue-50 p-3 font-semibold text-blue-950">
              This releases the batch to the line and cannot be undone.
            </p>
            {error && (
              <div ref={alertBox} tabIndex={-1} className="mt-3 rounded-lg border border-red-700 bg-red-50 p-3 text-red-950 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" role="alert">
                <p className="flex items-start gap-2 font-semibold">
                  <AlertIcon className="mt-1" />
                  {error.message}
                </p>
                {error.final && (
                  <Link href="/sewing" className="-mx-2 mt-2 inline-flex min-h-12 items-center px-2 font-semibold">
                    &larr; Back to the sewing queue
                  </Link>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className="btn btn-secondary min-h-12" onClick={() => { const refresh = error?.final; setOpen(false); if (refresh) router.refresh(); queueMicrotask(() => trigger.current?.focus()); }} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary min-h-12 aria-disabled:cursor-not-allowed aria-disabled:border-slate-400 aria-disabled:bg-slate-200 aria-disabled:text-slate-600" onClick={start} aria-disabled={busy || error?.final === true}>
                {busy && <SpinnerIcon />}
                {busy ? "Starting..." : "Confirm start"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
