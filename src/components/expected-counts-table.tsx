import { formatInt } from "@/lib/format";

/** Component x expected pieces. Used in the modal preview, the success view and the order page. */
export function ExpectedCountsTable({
  rows,
  caption = "Expected pieces per component",
}: {
  rows: { componentName: string; expectedQty: number }[];
  caption?: string;
}) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-slate-400 text-sm text-slate-900">
          <th scope="col" className="py-2 pr-4 font-semibold">
            Component
          </th>
          <th scope="col" className="py-2 text-right font-semibold">
            Expected pieces
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.componentName} className="border-b border-slate-200 last:border-0">
            <th scope="row" className="py-2 pr-4 font-medium text-slate-900">
              {row.componentName}
            </th>
            <td className="py-2 text-right font-mono tabular-nums text-slate-900">{formatInt(row.expectedQty)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
