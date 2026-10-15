"use client";

import { AlertIcon } from "@/components/icons";

// Last-resort boundary: a calm, readable message with a way to retry. Details stay in the server log.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <section className="card w-full p-6" aria-labelledby="err-title" role="alert">
        <h1 id="err-title" className="flex items-center gap-2 text-2xl font-bold text-red-900">
          <AlertIcon />
          Something went wrong
        </h1>
        <p className="mt-2 text-slate-800">The page could not be shown. Try again; if it keeps happening, tell your supervisor.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
