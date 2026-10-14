import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/badges";
import { ExpectedCountsTable } from "@/components/expected-counts-table";
import { RoleGate } from "@/components/role-gate";
import { getSessionUser } from "@/lib/auth/server";
import { formatDateTime, formatInt } from "@/lib/format";
import { getOrder } from "@/lib/services/orders";

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 font-medium text-slate-900" role="status">Loading order...</p>}>
      <OrderContent params={params} />
    </Suspense>
  );
}

async function OrderContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RoleGate path={`/orders/${encodeURIComponent(id)}`} roles={["cutting_supervisor"]} area="Cutting Orders">
      <OrderDetail id={id} />
    </RoleGate>
  );
}

// Read only for now: a later milestone adds the rejection note and resubmit on this same route.
async function OrderDetail({ id }: { id: string }) {
  const user = await getSessionUser();
  if (!user) return null; // RoleGate has already redirected a signed-out visitor
  const order = await getOrder(user, id);
  if (!order) notFound();

  const facts: [string, string][] = [
    ["Recipe", `${order.recipe.recipeCode} - ${order.recipe.name}`],
    ["Target quantity", `${formatInt(order.targetQty)} garments`],
    ["Fabric roll", order.fabricRollId],
    ["Fabric used", `${order.actualFabricYds} yds`],
    ["Attempt", String(order.currentAttempt)],
    ["Created by", order.createdBy.fullName],
    ["Created", formatDateTime(order.createdAt)],
  ];

  return (
    <div className="space-y-5">
      <Link href="/orders" className="inline-flex min-h-11 items-center font-semibold">
        &larr; Back to orders
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-slate-900">{order.orderNo}</h1>
        <StatusBadge status={order.status} />
      </div>

      <section className="card p-5" aria-labelledby="facts">
        <h2 id="facts" className="sr-only">
          Order details
        </h2>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-slate-700">{label}</dt>
              <dd className="font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card max-w-xl p-5" aria-labelledby="expected">
        <h2 id="expected" className="text-lg font-bold text-slate-900">
          Expected pieces to be counted
        </h2>
        <div className="mt-2">
          <ExpectedCountsTable rows={order.items} caption={`Expected pieces per component, attempt ${order.currentAttempt}`} />
        </div>
      </section>
    </div>
  );
}
