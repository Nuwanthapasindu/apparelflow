"use client";

import { useId, useState, useTransition } from "react";
import { apiFetch, hardNavigate } from "@/lib/client/api";
import type { DemoPersona } from "@/lib/demo";
import { LANDING } from "@/lib/nav";
import { AlertIcon, SpinnerIcon } from "./icons";

/**
 * Demo-mode Role Switcher. It does not flip any client-side role: it signs out (revoking the
 * current session family) and signs in again as the chosen persona through the real endpoints.
 */
export function RoleSwitcher({ personas, currentEmail }: { personas: DemoPersona[]; currentEmail: string }) {
  const selectId = useId();
  const [target, setTarget] = useState<DemoPersona | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const switching = pending || leaving;

  function switchTo(email: string) {
    const persona = personas.find((p) => p.email === email);
    if (!persona || persona.email === currentEmail) return;

    setError(null);
    setTarget(persona);

    startTransition(async () => {
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch {
        setError("Could not sign out. You are still signed in; try again.");
        return;
      }

      try {
        await apiFetch("/api/auth/login", { method: "POST", body: { email: persona.email, password: persona.password } });
      } catch {
        // Signed out, but the new sign-in failed: do not leave the user on a dead session.
        setLeaving(true);
        hardNavigate("/login?reason=switch-failed");
        return;
      }

      // Full page load so nothing from the previous role's pages survives in this tab's memory.
      setLeaving(true);
      hardNavigate(LANDING[persona.role]);
    });
  }

  const known = personas.some((p) => p.email === currentEmail);

  return (
    <div className="flex flex-col">
      <label htmlFor={selectId} className="mb-1 text-sm font-medium text-slate-700">
        Switch role
      </label>
      <select
        id={selectId}
        aria-label="Switch role"
        value={known ? currentEmail : ""}
        onChange={(e) => switchTo(e.target.value)}
        disabled={switching}
        className="min-w-52"
      >
        {!known && (
          <option value="" disabled>
            Switch role...
          </option>
        )}
        {personas.map((p) => (
          <option key={p.key} value={p.email}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="mt-1 min-h-5 text-sm font-medium text-slate-900" role="status" aria-live="polite">
        {switching && target && (
          <span className="inline-flex items-center gap-1.5">
            <SpinnerIcon />
            Switching to {target.label}...
          </span>
        )}
      </p>
      {error && (
        <p className="field-error" role="alert">
          <AlertIcon className="mt-0.5" />
          {error}
        </p>
      )}
    </div>
  );
}
