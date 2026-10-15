import { getSessionUser } from "@/lib/auth/server";
import { NAV } from "@/lib/nav";
import { RoleBadge } from "./badges";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

/**
 * Authenticated chrome. Rendered inside a <Suspense> boundary by the layout: the session read
 * makes it dynamic. With no valid session it renders only the page, which then redirects.
 * Navigation comes from the server-side role, so forbidden links are never in the DOM.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:text-blue-900"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-lg font-bold text-slate-900">
              ApparelFlow <span className="font-medium text-slate-700">Cutting Gatekeeper</span>
            </p>
            <NavLinks items={NAV[user.role]} />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex flex-col items-start gap-1">
              <span className="font-semibold text-slate-900">{user.fullName}</span>
              <RoleBadge role={user.role} />
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
