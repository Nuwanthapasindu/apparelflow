"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import type { DemoPersona } from "@/lib/demo";
import { LANDING } from "@/lib/nav";
import { SpinnerIcon } from "./icons";

/**
 * Demo-mode Role Switcher. It does not flip any client-side role: it signs out (revoking the
 * current session family) and signs in again as the chosen persona through the real endpoints.
 */
export function RoleSwitcher({ personas, currentEmail }: { personas: DemoPersona[]; currentEmail: string }) {
  const router = useRouter();
  const selectId = useId();
  const [target, setTarget] = useState<DemoPersona | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An async transition stays pending through logout, login and the navigation, until the new page renders.
  const [switching, startTransition] = useTransition();

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
        router.replace("/login?reason=switch-failed");
        router.refresh();
        return;
      }

      router.push(LANDING[persona.role]);
      router.refresh();
    });
  }

  const known = personas.some((p) => p.email === currentEmail);

  return (
    <div className="flex flex-col">
      <label htmlFor={selectId} className="sr-only">
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
          {error}
        </p>
      )}
    </div>
  );
}
