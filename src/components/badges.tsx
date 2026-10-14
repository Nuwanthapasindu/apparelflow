import type { OrderStatus, Role } from "@/generated/prisma/enums";
import { ROLE_LABEL } from "@/lib/nav";
import { CheckCircleIcon, ClockIcon, PlayIcon, ScissorsIcon, UserIcon, XCircleIcon } from "./icons";

// The status badge convention reused on later days. Colour is never the only signal: every status
// has an icon and a text label. Pure GREEN/YELLOW/RED are reserved for component traffic lights.
const STATUS = {
  PENDING_VERIFICATION: { label: "Pending verification", Icon: ClockIcon, style: "border-blue-700 bg-blue-50 text-blue-900" },
  REJECTED: { label: "Rejected", Icon: XCircleIcon, style: "border-2 border-red-700 bg-white text-red-900" },
  VERIFIED: { label: "Verified", Icon: CheckCircleIcon, style: "border-green-700 bg-green-50 text-green-900" },
  IN_SEWING: { label: "In sewing", Icon: PlayIcon, style: "border-indigo-700 bg-indigo-50 text-indigo-900" },
  CUTTING_IN_PROGRESS: { label: "Cutting in progress", Icon: ScissorsIcon, style: "border-slate-600 bg-slate-100 text-slate-900" },
} as const satisfies Record<OrderStatus, { label: string; Icon: typeof ClockIcon; style: string }>;

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { label, Icon, style } = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-semibold ${style}`}>
      <Icon />
      {label}
    </span>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-900">
      <UserIcon />
      {ROLE_LABEL[role]}
    </span>
  );
}
