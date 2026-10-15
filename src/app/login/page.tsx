import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { getSessionUser } from "@/lib/auth/server";
import { noticeFor } from "@/lib/login-notices";
import { LANDING } from "@/lib/nav";

async function LoginContent({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const user = await getSessionUser();
  if (user) redirect(LANDING[user.role]);

  const { reason } = await searchParams;
  return <LoginForm notice={noticeFor(reason)} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<p className="flex min-h-screen items-center justify-center font-medium text-slate-900">Loading...</p>}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}
