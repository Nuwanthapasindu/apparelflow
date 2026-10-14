import Link from "next/link";
import { formatDateTime, formatInt } from "@/lib/format";
import type { OrderListItemDto } from "@/lib/services/order-dto";
import { StatusBadge } from "./badges";

/** Table on wide screens, stacked cards on narrow ones. Both carry the same fields. */
export function OrdersTable({ orders }: { orders: OrderListItemDto[] }) {
  return (
    <>
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Cutting orders, newest first</caption>
          <thead>
            <tr className="border-b border-slate-400 bg-slate-50 text-sm text-slate-900">
              {["Order no", "Recipe", "Target qty", "Fabric roll", "Fabric used (yds)", "Status", "Attempt", "Created"].map((h, i) => (
                <th key={h} scope="col" className={`px-3 py-3 font-semibold ${i === 2 || i === 4 || i === 6 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-200 last:border-0 hover:bg-slate-50">
                <th scope="row" className="px-3 py-3 font-semibold">
                  <Link href={`/orders/${o.id}`} className="inline-flex min-h-11 items-center font-mono font-bold text-blue-800 underline">
                    {o.orderNo}
                  </Link>
                </th>
                <td className="px-3 py-3 text-slate-900">{o.recipe.name}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-900">{formatInt(o.targetQty)}</td>
                <td className="px-3 py-3 font-mono text-slate-900">{o.fabricRollId}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-900">{o.actualFabricYds}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-900">{o.currentAttempt}</td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-900">{formatDateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Cutting orders, newest first">
        {orders.map((o) => (
          <li key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/orders/${o.id}`} className="inline-flex min-h-11 items-center font-mono text-lg font-bold text-blue-800 underline">
                {o.orderNo}
              </Link>
              <StatusBadge status={o.status} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-slate-900">
              <Field label="Recipe" value={o.recipe.name} />
              <Field label="Target qty" value={formatInt(o.targetQty)} />
              <Field label="Fabric roll" value={o.fabricRollId} mono />
              <Field label="Fabric used (yds)" value={o.actualFabricYds} mono />
              <Field label="Attempt" value={String(o.currentAttempt)} />
              <Field label="Created" value={formatDateTime(o.createdAt)} />
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-slate-700">{label}</dt>
      <dd className={`font-medium ${mono ? "break-all font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
