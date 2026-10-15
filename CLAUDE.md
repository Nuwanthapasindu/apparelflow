# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ApparelFlow ERP: Cutting Gatekeeper. Webtezza (Pvt) Ltd Software Engineering Intern practical assessment (4 days). We are building and deploying the **Cutting Operations & Gatekeeper Verification Terminal**: a full-stack app where no cutting batch can reach the Sewing Queue unless a Cutting Verifier has counted every component and signed off. The hard stop is enforced **server-side and in PostgreSQL**, never only in the UI.

## Status

- **Day 1 (database): done.** Models, raw SQL guard triggers, RLS, seed, `DIRECT_URL` wiring, local test database and trigger tests.
- **Day 2 (auth, orders): done.** Custom JWT + rotating refresh auth, Role Switcher, order creation engine (`/api/recipes`, `/api/orders`), login page, role-based shell, orders list, creation modal, order detail. The `order_no_sequence` migration is applied to Supabase.
- **Day 3 (verifier gatekeeper): done.** Verifier queue and count workspace, row-locked approve/reject/resubmit services, server-side 422 hard stop, immutable decision history and fabric wastage snapshots. The `widen_wastage_pct` migration is applied to Supabase.
- **Guard gaps closed:** migration `fix_gatekeeper_guard_gaps` makes the approval guard count only items that match the order's recipe components, makes items validate recipe/name/expected quantity on insert, rejects whitespace-only rejection notes, requires an *active* sewing supervisor to start sewing, and makes the batch definition immutable (fabric yards editable only while `REJECTED`).
- **Day 4 (sewing release): done, deployed.** `listSewingQueue` is the single constant-filtered query behind `GET /api/sewing/queue`, the `/sewing` page and brief Test 5; `GET /api/sewing/active`, `GET /api/sewing/:id`, `POST /api/sewing/:id/start` (guarded transition, database-clock timestamp); sewing board and detail pages; RBAC matrix and full-flow tests; Playwright specs in `tests/e2e` (`yarn e2e`); README. The live site runs on Netlify; migrations are applied to Supabase by hand (`yarn prisma migrate deploy`) and the database is up to date.

**Update this section as each milestone lands.**

## Source of truth (highest first)

1. The challenge brief: `docs/challenge-brief.pdf`
2. `docs/DECISIONS.md` (settled decisions, imported below)
3. `docs/GAPS_AND_STARTUP_GUIDE.md` (known gaps, trigger SQL, day plan; read when working on DB triggers, auth or planning)
4. `prisma/schema.prisma` and the raw SQL migrations

If a request conflicts with a higher source, say so explicitly and ask which wins. Never silently pick one, and never invent requirements that contradict the brief.

@docs/DECISIONS.md

## Next.js version caveat

`AGENTS.md` warns that this Next.js (16.x, React 19.3) has breaking changes from what you may know. Before writing Next.js code, read the relevant guide under `node_modules/next/dist/docs/01-app/` (e.g. the Cache Components, route handlers, prefetching, and authentication guides). Heed deprecation notices. Note `layout.tsx` already uses the global `LayoutProps<"/">` type helper rather than hand-written prop types.

`next.config.ts` enables `cacheComponents` and `partialPrefetching`, and routes `*.css` through `@tailwindcss/turbopack` (Tailwind v4, imported via `@import "tailwindcss"` in `globals.css`; no `tailwind.config`). Cache Components changes how dynamic data access and caching behave in the App Router, so check the docs before fetching data, reading request APIs (cookies, headers, params) or writing route handlers. Anything per-user (session, orders, queue) must be dynamic and never cached or shared between users. In this Next version `middleware` has become `proxy`; neither is a security boundary (see rules).

## Commands

Package manager is **yarn**. Both `yarn.lock` and `package-lock.json` exist; never run `npm install`, and remove `package-lock.json` in its own commit so the lockfiles cannot diverge.

```bash
yarn dev                        # next dev
yarn build                      # next build
yarn start                      # next start
yarn lint                       # eslint (flat config: next core-web-vitals + typescript)
yarn tsc --noEmit               # type-check (no script defined); run `yarn next typegen` first on a clean checkout
yarn test                       # vitest against the LOCAL test Postgres (loads .env.test, aborts if the DB is not local and named *test*)
yarn test tests/api/orders.test.ts   # one file (always go through `yarn test`, never bare `vitest`)
yarn test:db:up                 # start the throwaway Postgres 16 on port 5433 (docker-compose.test.yml)
yarn test:db:migrate            # apply migrations to the test database (needs .env.test: cp .env.test.example .env.test)
yarn prisma validate            # must pass before every push
yarn prisma generate            # regenerate the client into src/generated/prisma
yarn prisma migrate dev --name <change>
yarn prisma migrate dev --create-only --name <change>   # raw SQL migrations (triggers, CHECKs, RLS)
yarn prisma db seed
```

Tests need the throwaway Postgres on port 5433 (`docker run -d --name apparelflow-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16`, database `apparelflow_test`) and a git-ignored `.env.test` that defines **both** `DATABASE_URL` and `DIRECT_URL` (localhost) and a `JWT_SECRET` of 32+ characters. Test files run serially and reset with `TRUNCATE ... CASCADE`. Layout: `tests/db-triggers` (raw SQL guards), `tests/api` (route handlers called directly with raw `Request`s), `tests/domain` and `tests/client` (pure logic, no DB). See `.claude/rules/testing.md`.

Never run `prisma migrate reset` or `prisma db push` (they wipe data or bypass migrations and triggers). Never read or print `.env*` files.

## Database (Prisma 6 + PostgreSQL on Supabase)

- `prisma/schema.prisma` uses the `prisma-client` generator with output `src/generated/prisma` (git-ignored). **Import the client and types from `@/generated/prisma/...`, not from `@prisma/client`**, and run `prisma generate` after cloning or changing the schema.
- `prisma.config.ts` loads `.env` via `dotenv/config` and reads `DATABASE_URL`. It sets `engine: "classic"`, and migrations go in `prisma/migrations`.
- `.env.example` lists `DATABASE_URL` (transaction-mode pooler, runtime), `DIRECT_URL` (session-mode pooler, migrations), `JWT_SECRET` and `NEXT_PUBLIC_DEMO_MODE`. **In this Prisma version the classic-engine `datasource` in `prisma.config.ts` overrides the schema datasource**, so `directUrl` is set there (the schema also carries it); verified that `migrate` uses `DIRECT_URL` and the generated client uses `DATABASE_URL`. `env()` in the config throws when a variable is missing, so every prisma command, including the `prisma generate` in `postinstall` and `build`, needs both URLs set (CI sets them at job level; the host (Netlify) needs both as environment variables).
- `.env.example` lists names only; fill real values into `.env` (git-ignored).
- Keep the existing generator and datasource blocks. Add the project's enums and models (see `docs/DECISIONS.md` and `docs/GAPS_AND_STARTUP_GUIDE.md`) without replacing them.
- Constraints Prisma cannot express (CHECKs, triggers, views, row level security) live in raw SQL migrations. Details: `.claude/rules/database.md`.

## Architecture (Day 1 and 2)

- **API layer** (`src/lib/api/`): every route is `handle(fn, { mutating })`. It converts thrown errors to the `{ data } / { error: { code, message, fields? } }` envelope, runs the Origin (CSRF) check first for mutations, maps database SQLSTATEs (`src/lib/db-errors.ts`: `GK403`/`GK409`/`GK422`/`23505`/`23514`) to 403/409/422/409/400, hides everything else behind a generic 500, and **rethrows Next.js control-flow errors** (those with a string `digest`). API code reads cookies from the `Request` and writes `Set-Cookie` by hand: never `next/headers` in `src/lib/auth` or routes, so handlers are callable from Vitest.
- **Auth** (`src/lib/auth/`): HS256 access JWT in `af_access` (only `sub`, `iat`, `exp`, `iss`; no role), opaque refresh token in `af_refresh` (`Path=/api/auth`, stored as SHA-256, rotated with an atomic conditional UPDATE, reuse revokes the family; rotation and revocation of one family are serialised by a per-family advisory lock so a logout cannot race a refresh). Passwords are hashed with Argon2id (`src/lib/auth/password-hash.ts`, OWASP minimum parameters, stored inside each hash); an unknown email returns 401 without any hash check, a deliberate decision that leaves a known timing difference between known and unknown emails. `requireRole(request, ...roles)` re-reads the user and role from the DB on every call. Pages cannot see the refresh cookie (its path), so a missing access cookie sends the browser to `/session/restore`, which tries `POST /api/auth/refresh` and falls back to `/login`.
- **Services** (`src/lib/services/`): plain functions that take the authenticated user and re-assert the role; used by route handlers and server components alike. Queries use explicit `select`s so hashes cannot leak. Order creation is one transaction (sequence number, order, items).
- **Validation** (`src/lib/validation/order.ts`) is the single source of limits and regexes, imported by the Zod schemas and the order modal. Domain math (`src/lib/domain/`) is pure and shared.
- **UI** (`src/app`, `src/components`): light theme only, explicit control styles in `globals.css`. Under Cache Components the session is read inside `<Suspense>` (`AppShell`, `RoleGate`), never at the top of a layout. Navigation links come from the server-side role. Sign out and role switching use a **full page load** (`hardNavigate`) because Next keeps visited routes hidden in the DOM and the previous user's data would otherwise stay in a shared terminal's tab. Double submits are blocked with a synchronous ref guard, not only a disabled button. Demo credentials reach the client as props only when `NEXT_PUBLIC_DEMO_MODE=true`.

## Conventions

- Path alias `@/*` maps to `src/*`. TypeScript is `strict`; the App Router lives in `src/app`.
- Domain logic (component multiplier, traffic-light status, wastage %) lives in **pure functions** under `src/lib/domain/`, unit-tested without a DB. Zod schemas in `src/lib/validation/`. Auth helpers (`requireRole`, tokens, cookies, refresh rotation) in `src/lib/auth/`.
- API routes under `src/app/api/` (auth, orders, verification, sewing); tests under `tests/` (domain, api, db-triggers).

## Non-negotiable invariants (details in `.claude/rules/gatekeeper-invariants.md`)

- Any RED, missing or uncounted component means approval fails with **422** on the API and in the DB.
- Only `cutting_verifier` can approve or reject. Wrong role gets **403**.
- Only `VERIFIED` orders appear in the Sewing Queue, via a literal `WHERE status = 'VERIFIED'`.
- Verifier id, timestamps, item status and wastage % come from the server, never the request body.
- The audit trail is append-only. Never weaken an invariant to make a test pass; fix the cause.

## How to work here

- **Ask before building anything ambiguous.** Ask short, precise clarifying questions rather than brainstorming several designs. Do not ask when the answer is in the source-of-truth files.
- **Act as an experienced tech lead.** Push back on risky or underspecified requests. For every non-trivial change, state edge cases, abuse vectors (Postman/cURL bypass), race conditions and anything that could corrupt historical audit data. Note briefly whether a change is additive for future needs; do not over-build.
- **Small, atomic changes** matching the 4-day plan. One concern per commit, imperative messages (e.g. `Add refresh token rotation with reuse detection`). Evaluators read the git history. Never add an AI co-author trailer or "Generated with" footer to commits or PRs (the owner's global rule).
- **Status transitions always get both paths:** the happy path and the rejection/hard-stop path, with tests.
- **Log every AI mistake you or the user catch** with the `/log-ai-mistake` skill, as it happens. `AI_OPTIMIZATION_REPORT.md` is a graded deliverable and needs at least 2 real, specific, honest examples. Never invent entries.
- **No scope creep:** no extra modules, no recipe-editing UI, nothing the brief doesn't ask for.
- Before finishing a task run `yarn lint`, `yarn prisma validate` and the tests (once they exist). Say plainly if anything wasn't run or failed.
- Use the `gatekeeper-reviewer` subagent before committing any change that touches auth, verification, status transitions, the sewing queue, migrations or triggers. Use `ui-contrast-auditor` after UI changes.

## Deliverables checklist (all mandatory)

Live deployed URL (Netlify is allowed by the brief); public GitHub repo with atomic commits; `AI_OPTIMIZATION_REPORT.md` (4 sections: tools and prompting, flawed AI code with at least 2 instances, human refactoring, defensive architecture); `README.md` (architecture, schema, demo credentials for all 3 roles, plus the documented interpretations: flag-only wastage cap, decimal fabric yards, `CUTTING_IN_PROGRESS` unused); passing automated tests.
