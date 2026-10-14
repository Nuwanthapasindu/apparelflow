"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { refreshSession } from "@/lib/client/api";
import { SpinnerIcon } from "./icons";

/** Tries to restore an expired access session with the refresh cookie, then continues or signs in. */
export function SessionRestore({ next }: { next: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    // refreshSession() is single-flight, so React Strict Mode's double effect cannot present the
    // same rotating token twice (which the server would treat as theft).
    refreshSession().then((ok) => {
      if (cancelled) return;
      if (ok) {
        router.replace(next);
        router.refresh();
      } else {
        router.replace("/login");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  return (
    <p className="flex items-center justify-center gap-2 p-8 font-medium text-slate-900" role="status">
      <SpinnerIcon />
      Restoring your session...
    </p>
  );
}
