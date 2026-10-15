import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RoleGate } from "@/components/role-gate";
import { VerificationWorkspace } from "@/components/verification-workspace";
import { getSessionUser } from "@/lib/auth/server";
import { getOrder } from "@/lib/services/orders";

export default function Page({ params }: PageProps<"/verify/[id]">) {
  return (
    <Suspense fallback={<p className="card p-5 font-semibold text-slate-900" role="status">Loading verification workspace...</p>}>
      <WorkspaceContent params={params} />
    </Suspense>
  );
}

async function WorkspaceContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RoleGate path={`/verify/${encodeURIComponent(id)}`} roles={["cutting_verifier"]} area="the Verifier Terminal">
      <WorkspaceOrder id={id} />
    </RoleGate>
  );
}

async function WorkspaceOrder({ id }: { id: string }) {
  const user = await getSessionUser();
  if (!user) return null;
  const order = await getOrder(user, id);
  if (!order) notFound();
  return <VerificationWorkspace initialOrder={order} />;
}
