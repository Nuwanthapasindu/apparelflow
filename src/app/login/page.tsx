import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { getSessionUser } from "@/lib/auth/server";
import { getDemoPersonas } from "@/lib/demo";
import { LANDING } from "@/lib/nav";

// Only these keys are accepted from the URL, so the query string cannot inject text into the page.
const NOTICES: Record<string, string> = {
  "switch-failed": "You were signed out, but signing in as the other role failed. Please sign in again.",
};

async function LoginContent({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const user = await getSessionUser();
  if (user) redirect(LANDING[user.role]);

  const { reason } = await searchParams;
  const notice = typeof reason === "string" ? NOTICES[reason] : undefined;
  return <LoginForm personas={getDemoPersonas()} notice={notice} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<p className="p-8 text-center font-medium text-slate-900">Loading...</p>}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}
