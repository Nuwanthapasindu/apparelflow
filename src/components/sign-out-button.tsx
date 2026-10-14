"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { SpinnerIcon } from "./icons";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Even if the request failed the user asked to leave: go to the login page.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={signOut} disabled={busy}>
      {busy && <SpinnerIcon />}
      {busy ? "Signing out..." : "Sign out"}
    </button>
  );
}
