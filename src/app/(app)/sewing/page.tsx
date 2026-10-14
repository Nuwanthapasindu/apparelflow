import { RoleGate } from "@/components/role-gate";

export default function Page() {
  return (
    <RoleGate path="/sewing" roles={["sewing_supervisor"]} area="the Sewing Queue">
      <h1 className="text-2xl font-bold text-slate-900">Sewing Queue</h1>
      <p className="card mt-4 max-w-xl p-4 text-slate-800">Arrives in the next milestone.</p>
    </RoleGate>
  );
}
