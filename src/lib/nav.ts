import type { Role } from "@/generated/prisma/enums";

export const ROLE_LABEL: Record<Role, string> = {
  cutting_supervisor: "Cutting Supervisor",
  cutting_verifier: "Cutting Verifier",
  sewing_supervisor: "Sewing Supervisor",
};

/** Where each role lands after signing in. */
export const LANDING: Record<Role, string> = {
  cutting_supervisor: "/orders",
  cutting_verifier: "/verify",
  sewing_supervisor: "/sewing",
};

export const LANDING_LABEL: Record<Role, string> = {
  cutting_supervisor: "Orders",
  cutting_verifier: "Verifier Terminal",
  sewing_supervisor: "Sewing Queue",
};

/** Navigation is decided on the server from the session, so a forbidden link is never in the DOM. */
export const NAV: Record<Role, { href: string; label: string }[]> = {
  cutting_supervisor: [{ href: "/orders", label: "Orders" }],
  cutting_verifier: [{ href: "/verify", label: "Verifier Terminal" }],
  sewing_supervisor: [{ href: "/sewing", label: "Sewing Queue" }],
};

/** Only same-site relative paths may be used as a post-login or post-restore destination. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 200) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next) || next.startsWith("/api/")) return "/";
  return next;
}
