# AI mistakes log

Raw notes for `AI_OPTIMIZATION_REPORT.md`. Each entry is a real mistake or near-miss from the Claude Code sessions on this repo, logged as it was caught.

## "prisma generate works without env vars" was wrong (2026-10-13)
- **Category:** other (unverified claim)
- **Where:** `prisma.config.ts` (`env("DATABASE_URL")`), `.github/workflows/ci.yml`
- **What the AI produced:** After wiring `DIRECT_URL`, the AI reported that `prisma generate` also works with no env vars set, so Vercel's install and build steps would not need them.
- **Why it was wrong:** The check ran inside the repo, where `prisma.config.ts` imports `dotenv/config` and silently loaded the real `.env`. In a clean checkout `env()` throws `Missing required environment variable: DATABASE_URL`, which fails `postinstall`, the build and CI.
- **How it was caught:** A dry run of the CI workflow in a clean directory containing only git-visible files (no `.env`, no `node_modules`).
- **Human fix:** `DATABASE_URL` and `DIRECT_URL` are set at job level in the workflow, pointing at the throwaway service container; `CLAUDE.md` now documents that every prisma command needs both variables (and that Vercel must define both).
- **Commit:** 700874a (workflow, committed in the CI pull request); the CLAUDE.md note ships with the Step 9 documentation commit

## Catch-all error wrapper swallowed Next.js control-flow errors (2026-10-14)
- **Category:** other (framework misuse)
- **Where:** `src/lib/api/handle.ts`, `handle()`
- **What the AI produced:** A `catch (error)` that turned every non-`ApiError` into a logged generic 500.
- **Why it was wrong:** Next.js signals "this route is dynamic" during prerender (and `redirect()`/`notFound()`) by throwing errors that carry a string `digest`. `GET /api/me` threw `NEXT_PRERENDER_INTERRUPTED` while `next build` generated static pages; the wrapper caught it, logged `[api] unhandled error` twice and returned a 500 instead of letting the framework handle it. It would also have broken any `redirect()` called inside a handler.
- **How it was caught:** The build log showed two unexpected `[api] unhandled error` lines. A temporary debug print revealed the digest and message.
- **Human fix:** `handle()` rethrows any error with a string `digest`; a regression test covers it.
- **Commit:** c8dd268

## Database error mapping assumed one error shape (2026-10-14, near-miss)
- **Category:** other (unverified assumption)
- **Where:** `src/lib/db-errors.ts`, `sqlStateOf()`
- **What the AI produced:** The Day 1 test helper read the SQLSTATE from `error.meta.code` / a `Code:` text, which was copied into the production mapper.
- **Why it was wrong:** That is the shape of raw queries (`P2010`). Order creation uses the typed client, which reports trigger rejections as `PrismaClientUnknownRequestError` with the code inside a `PostgresError { code: "GK403" ... }` text. Every trigger rejection from `POST /api/orders` would have been a generic 500 instead of 403/409/422.
- **How it was caught:** Before writing the mapper into the order service, a throwaway probe printed the real error shape from the typed client. A mutation check later confirmed the regression test fails without the fix.
- **Human fix:** `sqlStateOf` also parses the `PostgresError` form; tests cover both shapes and a real trigger rejection through `handle()`.
- **Commit:** 9dff550

## Double-submit guard relied only on React state (2026-10-14)
- **Category:** state sync / race
- **Where:** `src/components/new-order-modal.tsx` (`submit`), `src/components/login-form.tsx` (`signIn`)
- **What the AI produced:** "Submit is disabled while a request is in flight", implemented as `disabled={submitting}` set through `setState`.
- **Why it was wrong:** Two clicks in the same tick both run the handler before React re-renders and disables the button. A scripted double click in a real Chrome created **two** orders.
- **How it was caught:** A real-browser (headless Chrome) run that clicks Submit twice synchronously and counts orders through the API (6 before, 8 after).
- **Human fix:** A `useRef` in-flight flag that flips synchronously and makes the second call return immediately.
- **Commit:** c1f5d4c (login form), 290a39f (order modal)

## Client-side navigation on sign out left the previous user's data in the tab (2026-10-14)
- **Category:** insecure default
- **Where:** `src/components/sign-out-button.tsx`, `src/components/role-switcher.tsx`
- **What the AI produced:** Sign out and role switching used `router.replace/push` plus `router.refresh()`.
- **Why it was wrong:** With Cache Components Next keeps visited routes (hidden) in the DOM, and the first document's RSC payload stays in the page. After a switch or sign out at a shared terminal, the previous user's orders and recipes remained in that tab's memory and DOM.
- **How it was caught:** Reviewing why a table-row count in the browser run included the previous page's table; the run then asserted that the new role's document holds none of the supervisor's data.
- **Human fix:** Sign out and role switching call `hardNavigate()` (a full page load), and a browser check asserts the old in-memory state is gone.
- **Commit:** c1f5d4c

## A "test against the test database" command pointed at Supabase (2026-10-14, near-miss)
- **Category:** other
- **Where:** an ad-hoc shell command, not repo code
- **What the AI produced:** `yarn dotenv -e .env.test -- prisma migrate status` to check the test database.
- **Why it was wrong:** Yarn 1 mangles the `--`, `dotenv` never loaded `.env.test`, and the command reported the Supabase database. It was read-only (`migrate status`), so nothing changed, but the same mistake with `migrate deploy` would have touched the real database.
- **How it was caught:** The output printed the Supabase host instead of `localhost:5433`.
- **Human fix:** Call the binaries directly (`node_modules/.bin/dotenv -e .env.test -- node_modules/.bin/prisma ...`) and print the target host before anything that writes. The repo's own scripts and the test guard (`tests/helpers/assert-test-database.ts`) were never affected.
- **Commit:** none (practice change)

## Logout or login racing a refresh could leave a live session (2026-10-14)
- **Category:** state sync / race
- **Where:** `src/lib/auth/refresh.ts` (`revokeFamily`, used by logout and by login)
- **What the AI produced:** Refresh rotation was made atomic (conditional `UPDATE` in a transaction), but family revocation was a separate plain `UPDATE ... WHERE family_id = ? AND revoked_at IS NULL`, assumed to cover every token in the family.
- **Why it was wrong:** Under READ COMMITTED a revoke that starts while a rotation is in flight takes its snapshot before the successor token exists, blocks on the claimed row, and never sees the successor afterwards. The user logs out (or switches role) yet a live refresh token stays valid.
- **How it was caught:** The `gatekeeper-reviewer` agent flagged it by reasoning about Postgres semantics. A 25-round test (refresh in parallel with logout or login) then reproduced it: a live token survived in 5 to 6 rounds on every run.
- **Human fix:** Rotation and revocation both take a per-family transaction-scoped advisory lock (`pg_advisory_xact_lock`), so the second operation starts only after the first has committed. The race test now passes on repeated runs.
- **Commit:** 9eafb98

## First unknown-email login was slower than later ones (2026-10-14)
- **Category:** insecure default (timing side channel)
- **Where:** `src/lib/auth/password.ts`
- **What the AI produced:** A dummy bcrypt hash created lazily on first use, to equalise timing for unknown emails.
- **Why it was wrong:** The very first unknown-email request per server instance ran `bcrypt.hash` plus `bcrypt.compare`, about twice as slow as a known email, leaking "this email does not exist" once per cold start (relevant on serverless).
- **How it was caught:** Review by the `gatekeeper-reviewer` agent. A new test that loads the module fresh and asserts no `bcrypt.hash` call fails on the old code and passes on the fix.
- **Human fix:** A precomputed cost-10 hash constant; a test checks it is valid bcrypt with the same cost as real hashes.
- **Commit:** 9eafb98

## Plain objects used as lookup maps (2026-10-14)
- **Category:** validation/coercion
- **Where:** `src/lib/api/validate.ts` (`fields[key] ??= ...`), `src/app/login/page.tsx` (`NOTICES[reason]`)
- **What the AI produced:** Field-error and notice lookups on plain `{}` objects keyed by request data.
- **Why it was wrong:** Keys such as `constructor`, `toString` or `__proto__` resolve to inherited members. In `validate.ts` the error for such a key was silently dropped (a body with an extra `constructor` key returned 400 with no `fields` entry; reproduced by a failing test). In the login page `?reason=toString` would pass a function as a prop to a client component (reported by the reviewer from reading the code; I did not reproduce the crash before fixing it).
- **How it was caught:** Review by the `gatekeeper-reviewer` agent, then a failing test for the validation case.
- **Human fix:** `Object.create(null)` for the field map and an own-property check (`Object.hasOwn`) in a small `noticeFor` helper, with tests for the prototype-named keys.
- **Commit:** 9eafb98

## A NUL byte in an order id returned a 500 (2026-10-14)
- **Category:** validation/coercion
- **Where:** `src/lib/services/orders.ts` (`getOrder`), `GET /api/orders/:id`
- **What the AI produced:** The id from the URL went straight into a Prisma `findUnique` on a TEXT column.
- **Why it was wrong:** Postgres rejects NUL bytes in text, so `GET /api/orders/a%00b` produced an unmapped database error and a generic 500 instead of a 404.
- **How it was caught:** Flagged as speculative by the reviewer, then confirmed: new test cases with a NUL byte returned 500.
- **Human fix:** Order ids are UUIDs, so anything that does not match the UUID pattern is "not found" without querying.
- **Commit:** 9eafb98

## A timing-dependent test assertion (2026-10-14)
- **Category:** test gap
- **Where:** `tests/db-triggers/edge-cases.test.ts` (sewing overwrite test, written on Day 1)
- **What the AI produced:** `UPDATE ... SET sewing_started_at = now()` expected to be rejected as a change.
- **Why it was wrong:** When the database and host clocks are close, `now()` can equal the stored millisecond, making it a no-op update that the trigger rightly allows. The test failed twice in a row, then passed six times.
- **How it was caught:** An intermittent failure in the full suite; ruling out concurrent database use and a changed trigger (the live function text was intact), then reproducing the trigger in plain SQL.
- **Human fix:** Update to `sewing_started_at + interval '1 second'`, which always differs.
- **Commit:** 1ee1ad6
