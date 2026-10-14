"use client";

import { useState } from "react";
import { apiFetch, hardNavigate } from "@/lib/client/api";
import { SpinnerIcon } from "./icons";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      // A full page load, not a client-side navigation: the previous user's page data (the RSC
      // payload) would otherwise stay in this tab's memory for the next person at a shared terminal.
      // Even if the request failed the user asked to leave, so go to the login page regardless.
      hardNavigate("/login");
    }
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={signOut} disabled={busy}>
      {busy && <SpinnerIcon />}
      {busy ? "Signing out..." : "Sign out"}
    </button>
  );
}
