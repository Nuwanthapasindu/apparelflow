import Link from "next/link";

// Themed replacement for Next's default 404 (which brings its own dark-mode colours and no way out).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <section className="card w-full p-6" aria-labelledby="nf-title">
        <h1 id="nf-title" className="text-2xl font-bold text-slate-900">
          Page not found
        </h1>
        <p className="mt-2 text-slate-800">That page or order does not exist, or the link is out of date.</p>
        <Link href="/" className="btn btn-primary mt-4 no-underline">
          Go to my home page
        </Link>
      </section>
    </main>
  );
}
