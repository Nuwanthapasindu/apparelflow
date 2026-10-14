import { Suspense } from "react";
import { SessionRestore } from "@/components/session-restore";
import { safeNext } from "@/lib/nav";

async function Restore({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  // Never redirect to anything but a same-site relative path (no open redirect).
  return <SessionRestore next={safeNext(typeof next === "string" ? next : undefined)} />;
}

export default function RestorePage({ searchParams }: PageProps<"/session/restore">) {
  return (
    <Suspense fallback={<p className="p-8 text-center font-medium text-slate-900">Restoring your session...</p>}>
      <Restore searchParams={searchParams} />
    </Suspense>
  );
}
