import { Suspense } from "react";
import { RoleGate } from "@/components/role-gate";

export default function Page() {
  return (
    // RoleGate reads the session cookie, so it must sit inside the boundary (see verify/page.tsx).
    <Suspense fallback={<p className="p-4 font-medium text-slate-900" role="status">Loading...</p>}>
      <RoleGate path="/sewing" roles={["sewing_supervisor"]} area="the Sewing Queue">
        <h1 className="text-2xl font-bold text-slate-900">Sewing Queue</h1>
        <p className="card mt-4 max-w-xl p-4 text-slate-800">Arrives in the next milestone.</p>
      </RoleGate>
    </Suspense>
  );
}
