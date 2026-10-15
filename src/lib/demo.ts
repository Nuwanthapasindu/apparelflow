import type { Role } from "@/generated/prisma/enums";

export type DemoPersona = {
  key: string;
  role: Role;
  label: string;
  summary: string;
  email: string;
  password: string;
};

// Public demo accounts (also documented in the README). They only hold demo data.
const PERSONAS: DemoPersona[] = [
  {
    key: "supervisor",
    role: "cutting_supervisor",
    label: "Cutting Supervisor",
    summary: "Creates cutting orders and logs fabric used. Cannot verify counts or see the Sewing Queue.",
    email: "cutting.supervisor@apparelflow.test",
    password: "Demo-Supervisor-1",
  },
  {
    key: "verifier",
    role: "cutting_verifier",
    label: "Cutting Verifier",
    summary: "Counts every component, then approves or rejects. Cannot create orders or see the Sewing Queue.",
    email: "cutting.verifier@apparelflow.test",
    password: "Demo-Verifier-1",
  },
  {
    key: "sewing",
    role: "sewing_supervisor",
    label: "Sewing Supervisor",
    summary: "Sees verified batches and starts sewing. Never sees pending or rejected orders.",
    email: "sewing.supervisor@apparelflow.test",
    password: "Demo-Sewing-1",
  },
];

export const isDemoMode = () => process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * Called from server components only and passed down as props, so the credentials never ship in
 * the client bundle unless demo mode is switched on. Empty when demo mode is off.
 */
export function getDemoPersonas(): DemoPersona[] {
  return isDemoMode() ? PERSONAS : [];
}
