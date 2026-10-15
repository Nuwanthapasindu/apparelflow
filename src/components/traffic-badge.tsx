import type { ItemStatus } from "@/generated/prisma/enums";
import { AlertIcon, CheckCircleIcon, CircleDashedIcon, PercentIcon, XCircleIcon } from "./icons";

const TRAFFIC = {
  GREEN: { label: "MATCH", Icon: CheckCircleIcon, style: "border-green-700 bg-green-100 text-green-950" },
  YELLOW: { label: "EXCESS", Icon: AlertIcon, style: "border-amber-700 bg-amber-100 text-amber-950" },
  RED: { label: "SHORTAGE", Icon: XCircleIcon, style: "border-red-700 bg-red-100 text-red-950" },
  UNCOUNTED: { label: "NOT COUNTED", Icon: CircleDashedIcon, style: "border-slate-600 bg-slate-100 text-slate-900" },
} as const;

export function TrafficBadge({ status }: { status: ItemStatus | null }) {
  const item = TRAFFIC[status ?? "UNCOUNTED"];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold tracking-wide ${item.style}`}>
      <item.Icon />
      {item.label}
    </span>
  );
}

export function OverCapBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-700 bg-amber-100 px-2.5 py-1 text-xs font-bold tracking-wide text-amber-950">
      <PercentIcon />
      OVER CAP
    </span>
  );
}
