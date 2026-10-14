"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/validation/auth";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { DemoPersona } from "@/lib/demo";
import { LANDING, ROLE_LABEL } from "@/lib/nav";
import type { Role } from "@/generated/prisma/enums";
import { AlertIcon, SpinnerIcon } from "./icons";

type LoginResult = { user: { role: Role } };

export function LoginForm({ personas, notice }: { personas: DemoPersona[]; notice?: string }) {
  const router = useRouter();
  const ids = { email: useId(), password: useId(), error: useId() };
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "manual" or a persona key

  async function signIn(credentials: { email: string; password: string }, who: string) {
    setBusy(who);
    setFormError(null);
    try {
      const { user } = await apiFetch<LoginResult>("/api/auth/login", { method: "POST", body: credentials });
      router.replace(LANDING[user.role]);
      router.refresh();
    } catch (e) {
      setBusy(null);
      if (e instanceof ApiClientError && e.status === 401) setFormError("Invalid email or password");
      else if (e instanceof ApiClientError && e.status === 400) setFormError("Check the email and password and try again");
      else setFormError("Could not sign in. Check your connection and try again.");
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    const trimmed = email.trim();
    if (!trimmed) errors.email = "Enter your email";
    else if (trimmed.length > MAX_EMAIL_LENGTH) errors.email = "That email is too long";
    if (!password) errors.password = "Enter your password";
    else if (password.length > MAX_PASSWORD_LENGTH) errors.password = "That password is too long";
    setFieldErrors(errors);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();
    void signIn({ email: trimmed, password }, "manual");
  }

  const disabled = busy !== null;
  const describedBy = (field: "email" | "password") =>
    [fieldErrors[field] ? `${ids[field]}-error` : null, formError ? ids.error : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-10 lg:grid-cols-2">
      <section className="card p-6" aria-labelledby="signin-title">
        <h1 id="signin-title" className="text-2xl font-bold text-slate-900">
          Sign in
        </h1>
        <p className="mt-1 text-slate-800">ApparelFlow Cutting Gatekeeper</p>

        {notice && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-700 bg-amber-50 p-3 font-medium text-amber-950" role="status">
            <AlertIcon className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        <form onSubmit={submit} noValidate className="mt-5 space-y-4">
          <div>
            <label htmlFor={ids.email} className="field-label">
              Email
            </label>
            <input
              ref={emailRef}
              id={ids.email}
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled}
              aria-invalid={fieldErrors.email || formError ? true : undefined}
              aria-describedby={describedBy("email")}
            />
            {fieldErrors.email && (
              <p id={`${ids.email}-error`} className="field-error">
                <AlertIcon className="mt-0.5" />
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={ids.password} className="field-label">
              Password
            </label>
            <input
              ref={passwordRef}
              id={ids.password}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={disabled}
              aria-invalid={fieldErrors.password || formError ? true : undefined}
              aria-describedby={describedBy("password")}
            />
            {fieldErrors.password && (
              <p id={`${ids.password}-error`} className="field-error">
                <AlertIcon className="mt-0.5" />
                {fieldErrors.password}
              </p>
            )}
          </div>

          {formError && (
            <p id={ids.error} className="field-error text-base" role="alert">
              <AlertIcon className="mt-1" />
              {formError}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={disabled}>
            {busy === "manual" && <SpinnerIcon />}
            {busy === "manual" ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>

      {personas.length > 0 && (
        <section aria-labelledby="demo-title">
          <h2 id="demo-title" className="text-lg font-bold text-slate-900">
            Demo accounts
          </h2>
          <p className="mt-1 text-slate-800">Public demo logins with sample data. Pick a role to sign in as that user.</p>
          <ul className="mt-4 space-y-3">
            {personas.map((p) => (
              <li key={p.key} className="card p-4">
                <h3 className="font-bold text-slate-900">{ROLE_LABEL[p.role]}</h3>
                <p className="mt-1 text-slate-800">{p.summary}</p>
                <p className="mt-2 break-all font-mono text-sm text-slate-900">{p.email}</p>
                <button
                  type="button"
                  className="btn btn-secondary mt-3"
                  disabled={disabled}
                  onClick={() => signIn({ email: p.email, password: p.password }, p.key)}
                >
                  {busy === p.key && <SpinnerIcon />}
                  {busy === p.key ? "Signing in..." : `Sign in as ${p.label}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
