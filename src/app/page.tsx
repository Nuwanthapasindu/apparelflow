import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/server";
import { LANDING } from "@/lib/nav";

// Signed in: straight to the role's landing page. Otherwise try to restore, which falls back to /login.
async function Home() {
  const user = await getSessionUser();
  return redirect(user ? LANDING[user.role] : "/session/restore?next=%2F");
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-center font-medium text-slate-900">Loading...</p>}>
      <Home />
    </Suspense>
  );
}
