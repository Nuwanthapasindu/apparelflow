import { Suspense } from "react";
import { RoleGate } from "@/components/role-gate";
import { SewingBoard } from "@/components/sewing-board";
import { getSessionUser } from "@/lib/auth/server";
import { getSewingActive, getSewingQueue } from "@/lib/services/sewing";

// RoleGate reads the session cookie, so it sits inside the boundary (see verify/page.tsx).
export default function Page() {
  return (
    <Suspense fallback={<p className="card p-5 font-semibold text-slate-900" role="status">Loading the sewing queue...</p>}>
      <RoleGate path="/sewing" roles={["sewing_supervisor"]} area="the Sewing Queue">
        <SewingContent />
      </RoleGate>
    </Suspense>
  );
}

// The same functions as GET /api/sewing/queue and /active: the page ships exactly the tested query.
async function SewingContent() {
  const user = await getSessionUser();
  if (!user) return null; // RoleGate has already redirected a signed-out visitor
  const [queue, active] = await Promise.all([getSewingQueue(user, { limit: 100 }), getSewingActive(user, { limit: 100 })]);
  return <SewingBoard initial={{ queue, active }} initialNow={new Date().toISOString()} />;
}
