import { Suspense } from "react";
import { NewOrderButton } from "@/components/new-order-modal";
import { OrdersTable } from "@/components/orders-table";
import { RoleGate } from "@/components/role-gate";
import { StatusFilter } from "@/components/status-filter";
import { ApiError } from "@/lib/api/errors";
import { getSessionUser } from "@/lib/auth/server";
import { formatInt } from "@/lib/format";
import { listOrders, listRecipes } from "@/lib/services/orders";
import { parseListOrdersQuery } from "@/lib/validation/order-query";

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    // RoleGate reads the session cookie, so it must sit inside the boundary (see verify/page.tsx).
    <Suspense fallback={<p className="p-4 font-medium text-slate-900" role="status">Loading orders...</p>}>
      <RoleGate path="/orders" roles={["cutting_supervisor"]} area="Cutting Orders">
        <OrdersContent searchParams={searchParams} />
      </RoleGate>
    </Suspense>
  );
}

async function OrdersContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user) return null; // RoleGate has already redirected a signed-out visitor
  const raw = await searchParams;

  // Same strict parsing as the API; a bad ?status= falls back to the unfiltered list.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) for (const v of [value].flat()) if (v !== undefined) params.append(key, v);
  let query;
  try {
    query = parseListOrdersQuery(params);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    query = parseListOrdersQuery(new URLSearchParams());
  }

  const [{ orders, hasMore }, recipes] = await Promise.all([listOrders(user, query), listRecipes(user)]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Cutting Orders</h1>
        <NewOrderButton recipes={recipes} />
      </div>

      <StatusFilter current={query.status ?? ""} />

      {orders.length === 0 ? (
        <div className="card p-8 text-center">
          <h2 className="text-lg font-bold text-slate-900">{query.status ? "No orders with that status" : "No cutting orders yet"}</h2>
          <p className="mx-auto mt-1 max-w-md text-slate-800">
            {query.status
              ? "Try another status, or show all orders."
              : "Create the first order to send a batch to the Cutting Verifier for counting."}
          </p>
          {!query.status && (
            <div className="mt-4">
              <NewOrderButton recipes={recipes} />
            </div>
          )}
        </div>
      ) : (
        <>
          <OrdersTable orders={orders} />
          {hasMore && (
            <p className="text-slate-800">
              Showing the newest {formatInt(orders.length)} orders. Use the status filter to narrow the list.
            </p>
          )}
        </>
      )}
    </div>
  );
}
