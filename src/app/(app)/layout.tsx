import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";

// The session read lives inside AppShell, behind this boundary, so the layout itself stays static
// and nothing user-specific is ever part of a cached or shared shell.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="p-8 text-center font-medium text-slate-900" role="status">Loading...</p>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
