import { RoleGate } from "@/components/role-gate";

export default function OrdersPage() {
  return (
    <RoleGate path="/orders" roles={["cutting_supervisor"]} area="Cutting Orders">
      <h1 className="text-2xl font-bold text-slate-900">Cutting Orders</h1>
    </RoleGate>
  );
}
