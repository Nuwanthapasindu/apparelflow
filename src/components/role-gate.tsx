import { redirect } from "next/navigation";
import Link from "next/link";
import type { Role } from "@/generated/prisma/enums";
import { getSessionUser } from "@/lib/auth/server";
import { LANDING, LANDING_LABEL, ROLE_LABEL } from "@/lib/nav";

/**
 * Page guard. Signed out: go and try to restore the session (the browser sends the refresh cookie
 * to /api/auth only, so a page cannot see it; the restore page tries the refresh and falls back
 * to /login). Wrong role: a clear screen with a way back. Courtesy only: the API is the boundary.
 */
export async function RoleGate({
  path,
  roles,
  area,
  children,
}: {
  path: string;
  roles: Role[];
  area: string;
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect(`/session/restore?next=${encodeURIComponent(path)}`);

  if (!roles.includes(user.role)) {
    return (
      <section className="card mx-auto max-w-xl p-6" aria-labelledby="denied-title">
        <h1 id="denied-title" className="text-xl font-bold text-slate-900">
          You do not have access to this page
        </h1>
        <p className="mt-2 text-slate-800">
          Your role ({ROLE_LABEL[user.role]}) cannot access {area}.
        </p>
        <Link href={LANDING[user.role]} className="btn btn-primary mt-4 no-underline">
          Go to {LANDING_LABEL[user.role]}
        </Link>
      </section>
    );
  }
  return <>{children}</>;
}
