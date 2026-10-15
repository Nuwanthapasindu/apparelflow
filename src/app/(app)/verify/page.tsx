import { Suspense } from "react";
import { RoleGate } from "@/components/role-gate";
import { VerifierQueue } from "@/components/verifier-queue";
import { getSessionUser } from "@/lib/auth/server";
import { listOrders } from "@/lib/services/orders";

export default function Page({ searchParams }: PageProps<"/verify">) {
  return (
    <RoleGate path="/verify" roles={["cutting_verifier"]} area="the Verifier Terminal">
      <Suspense fallback={<p className="card p-5 font-semibold text-slate-900" role="status">Loading verification queue...</p>}>
        <QueueContent searchParams={searchParams} />
      </Suspense>
    </RoleGate>
  );
}

async function QueueContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user) return null;
  const [{ orders }, query] = await Promise.all([listOrders(user, { limit: 100 }), searchParams]);
  const result = typeof query.result === "string" ? query.result : undefined;
  const orderNo = typeof query.order === "string" ? query.order : undefined;
  return <VerifierQueue initialOrders={orders} initialNow={new Date().toISOString()} result={result} orderNo={orderNo} />;
}
