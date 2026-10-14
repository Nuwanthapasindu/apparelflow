"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import {
  EMPTY_ORDER_FORM,
  ORDER_FORM_FIELDS,
  previewCounts,
  splitServerFields,
  validateOrderField,
  validateOrderForm,
  type OrderFormErrors,
  type OrderFormField,
  type OrderFormValues,
} from "@/lib/validation/order-form";
import type { OrderDetailDto, RecipeDto } from "@/lib/services/order-dto";
import { ExpectedCountsTable } from "./expected-counts-table";
import { AlertIcon, CheckCircleIcon, SpinnerIcon } from "./icons";

/** A button that opens the order modal. Rendered only on the supervisor's page. */
export function NewOrderButton({ recipes, className = "btn btn-primary" }: { recipes: RecipeDto[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={trigger} type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        New Cutting Order
      </button>
      <OrderDialog
        recipes={recipes}
        open={open}
        onClose={() => {
          setOpen(false);
          // Native <dialog> restores focus itself; this is the fallback for browsers that do not.
          queueMicrotask(() => trigger.current?.focus());
        }}
      />
    </>
  );
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab and Shift+Tab inside the dialog. A native modal already makes the page behind it inert,
 * but focus can still wander out to the browser's own UI; wrapping at the ends keeps it in the form.
 */
function trapTab(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0,
  );
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Native <dialog> opened with showModal(): the browser provides Escape to close and an inert
 * background, and trapTab keeps focus inside. The form is mounted only while open, so it starts fresh every time.
 */
function OrderDialog({ recipes, open, onClose }: { recipes: RecipeDto[]; open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      onCancel={(e) => {
        e.preventDefault(); // Escape: close through our state, and never mid-request
        if (!busy) onClose();
      }}
      className="m-auto w-[calc(100%-1rem)] max-w-2xl rounded-xl border border-slate-500 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/60"
    >
      {open && <OrderForm recipes={recipes} titleId={titleId} onClose={onClose} onBusy={setBusy} />}
    </dialog>
  );
}

function OrderForm({
  recipes,
  titleId,
  onClose,
  onBusy,
}: {
  recipes: RecipeDto[];
  titleId: string;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState<OrderFormValues>(EMPTY_ORDER_FORM);
  const [errors, setErrors] = useState<OrderFormErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<OrderDetailDto | null>(null);
  // Disabling the button through state is not enough: two clicks in the same tick both run this
  // handler before React re-renders. A ref flips synchronously, so the second click is ignored.
  const inFlight = useRef(false);
  const refs = useRef<Partial<Record<OrderFormField, HTMLInputElement | HTMLSelectElement | null>>>({});
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (created) successHeading.current?.focus();
  }, [created]);

  const recipe = recipes.find((r) => r.id === values.recipeId);
  const preview = previewCounts(recipe?.components, values.targetQty);
  const id = (field: OrderFormField) => `${uid}-${field}`;
  const describedBy = (field: OrderFormField) => [`${id(field)}-hint`, errors[field] ? `${id(field)}-error` : null].filter(Boolean).join(" ");

  function change(field: OrderFormField, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    // Once a field shows an error, re-check as the person types so it clears the moment it is fixed.
    if (errors[field]) setErrors((e) => ({ ...e, [field]: validateOrderField(field, next) }));
  }

  function blur(field: OrderFormField) {
    setErrors((e) => ({ ...e, [field]: validateOrderField(field, values) }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setBanner(null);
    const { errors: found, payload } = validateOrderForm(values);
    setErrors(found);
    if (!payload) {
      const first = ORDER_FORM_FIELDS.find((f) => found[f]);
      if (first) refs.current[first]?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    onBusy(true);
    try {
      const { order } = await apiFetch<{ order: OrderDetailDto }>("/api/orders", { method: "POST", body: payload });
      setCreated(order);
      router.refresh(); // the list behind the dialog now includes the new order
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 400) {
        const { mapped, other } = splitServerFields(e.fields);
        setErrors(mapped);
        const first = ORDER_FORM_FIELDS.find((f) => mapped[f]);
        if (first) refs.current[first]?.focus();
        setBanner(other.length ? other.join(" ") : first ? null : e.message);
      } else if (e instanceof ApiClientError && e.status === 401) {
        setBanner("Your session has ended. Sign in again to create orders.");
      } else if (e instanceof ApiClientError && e.status === 403) {
        setBanner("Your role is not allowed to create cutting orders.");
      } else {
        setBanner("The order could not be created. Check your connection and try again.");
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      onBusy(false);
    }
  }

  function createAnother() {
    setValues(EMPTY_ORDER_FORM);
    setErrors({});
    setBanner(null);
    setCreated(null);
    queueMicrotask(() => refs.current.recipeId?.focus());
  }

  if (created) {
    return (
      <div className="p-5">
        <h2 id={titleId} ref={successHeading} tabIndex={-1} className="flex items-start gap-2 text-xl font-bold text-green-900">
          <CheckCircleIcon className="mt-1" />
          Order {created.orderNo} submitted for verification
        </h2>
        <p className="mt-2 text-slate-900">
          {created.recipe.name}, {created.targetQty} garments. A Cutting Verifier will count each component below.
        </p>
        <div className="mt-4 rounded-lg border border-slate-300 p-3">
          <ExpectedCountsTable rows={created.items} />
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={createAnother}>
            Create another
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const fieldError = (field: OrderFormField) =>
    errors[field] && (
      <p id={`${id(field)}-error`} className="field-error">
        <AlertIcon className="mt-0.5" />
        {errors[field]}
      </p>
    );

  return (
    <form onSubmit={submit} noValidate className="max-h-[90vh] overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-xl font-bold text-slate-900">
          New Cutting Order
        </h2>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting} aria-label="Close">
          Close
        </button>
      </div>

      {banner && (
        <p className="field-error mt-4 rounded-lg border border-red-800 bg-red-50 p-3 text-base" role="alert">
          <AlertIcon className="mt-1" />
          {banner}
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={id("recipeId")} className="field-label">
            Recipe
          </label>
          <select
            id={id("recipeId")}
            data-autofocus
            ref={(el) => void (refs.current.recipeId = el)}
            value={values.recipeId}
            onChange={(e) => change("recipeId", e.target.value)}
            onBlur={() => blur("recipeId")}
            disabled={submitting}
            aria-invalid={errors.recipeId ? true : undefined}
            aria-describedby={describedBy("recipeId")}
          >
            <option value="">Choose a recipe...</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.recipeCode} - {r.name}
              </option>
            ))}
          </select>
          <p id={`${id("recipeId")}-hint`} className="field-hint">
            Decides which components must be counted.
          </p>
          {fieldError("recipeId")}
        </div>

        <div>
          <label htmlFor={id("targetQty")} className="field-label">
            Target batch quantity
          </label>
          <input
            id={id("targetQty")}
            ref={(el) => void (refs.current.targetQty = el)}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.targetQty}
            onChange={(e) => change("targetQty", e.target.value)}
            onBlur={() => blur("targetQty")}
            disabled={submitting}
            aria-invalid={errors.targetQty ? true : undefined}
            aria-describedby={describedBy("targetQty")}
          />
          <p id={`${id("targetQty")}-hint`} className="field-hint">
            Garments to cut. Whole number, 1 to 100,000.
          </p>
          {fieldError("targetQty")}
        </div>

        <div>
          <label htmlFor={id("fabricRollId")} className="field-label">
            Fabric Roll ID
          </label>
          <input
            id={id("fabricRollId")}
            ref={(el) => void (refs.current.fabricRollId = el)}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={values.fabricRollId}
            onChange={(e) => change("fabricRollId", e.target.value)}
            onBlur={() => blur("fabricRollId")}
            disabled={submitting}
            aria-invalid={errors.fabricRollId ? true : undefined}
            aria-describedby={describedBy("fabricRollId")}
          />
          <p id={`${id("fabricRollId")}-hint`} className="field-hint">
            For example FAB-ROLL-882. Letters, digits, . _ - (3 to 40 characters).
          </p>
          {fieldError("fabricRollId")}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={id("actualFabricYds")} className="field-label">
            Actual fabric used (yds)
          </label>
          <input
            id={id("actualFabricYds")}
            ref={(el) => void (refs.current.actualFabricYds = el)}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.actualFabricYds}
            onChange={(e) => change("actualFabricYds", e.target.value)}
            onBlur={() => blur("actualFabricYds")}
            disabled={submitting}
            aria-invalid={errors.actualFabricYds ? true : undefined}
            aria-describedby={describedBy("actualFabricYds")}
            className="sm:max-w-xs"
          />
          <p id={`${id("actualFabricYds")}-hint`} className="field-hint">
            Yards used from the roll. Greater than 0, up to 2 decimals (for example 91.5).
          </p>
          {fieldError("actualFabricYds")}
        </div>
      </div>

      <section className="mt-5 rounded-lg border border-slate-300 bg-slate-50 p-3" aria-labelledby={`${uid}-preview`}>
        <h3 id={`${uid}-preview`} className="font-semibold text-slate-900">
          Expected pieces to be counted
        </h3>
        {preview ? (
          <div className="mt-2">
            <ExpectedCountsTable rows={preview} caption="Expected pieces per component for this batch" />
          </div>
        ) : (
          <p className="mt-1 text-slate-800">Choose a recipe and enter a valid quantity to see the expected piece counts.</p>
        )}
        <p className="field-hint">Preview only. The server calculates the official counts when the order is created.</p>
      </section>

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting && <SpinnerIcon />}
          {submitting ? "Submitting..." : "Submit for verification"}
        </button>
      </div>
    </form>
  );
}
