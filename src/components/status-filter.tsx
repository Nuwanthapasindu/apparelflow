"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import type { OrderStatus } from "@/generated/prisma/enums";
import { STATUS_LABEL } from "./badges";

// CUTTING_IN_PROGRESS exists only to match the brief's diagram and is never assigned, so offering it would always show an empty list.
const STATUSES = (Object.keys(STATUS_LABEL) as OrderStatus[]).filter((s) => s !== "CUTTING_IN_PROGRESS");

export function StatusFilter({ current }: { current: OrderStatus | "" }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="sm:w-64">
      <label htmlFor={id} className="field-label">
        Filter by status
      </label>
      <select id={id} value={current} onChange={(e) => router.replace(e.target.value ? `/orders?status=${e.target.value}` : "/orders")}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
