# AI Optimization Report

> **How this report was made.** It was drafted by the assistant (Claude Code) from the git history, the running AI mistake log (`AI_NOTES.md`, kept locally), the migrations, the tests and the code, then submitted by the author, who answered the questions only the author could answer. Nothing here was invented.

## 1. Tools & Prompting

### Tools

| Tool | What it was used for | Source |
|---|---|---|
| Claude Code (CLI), with two review subagents (`gatekeeper-reviewer`, `ui-contrast-auditor`) and two skills (`add-api-endpoint`, `log-ai-mistake`) | Implementation of the schema, migrations, API, UI and tests, steered by `CLAUDE.md` and `.claude/rules/*`; independent review of every change that touched auth, verification, migrations or UI | `CLAUDE.md`, `.claude/agents/`, `.claude/rules/`, `.claude/skills/` in the repository; `git log` |
| Claude (chat, claude.ai) | Requirement analysis, decision questions, schema and SQL drafts, the per-day task specifications and the ER diagram. The author reviewed the task files before handing them to Claude Code. | Author-confirmed |
| Eraser | A diagramming tool the author used. No Eraser output is committed to this repository (the README diagrams are Mermaid). | Author-confirmed |
| Other AI tools (autocomplete, other chat assistants) | None | Author-confirmed |

### Prompting method

What the repository itself shows:

- **A written task file per day** (Day 1 database, Day 2 auth and orders, Day 3 verifier gatekeeper, Day 4 sewing and release) listing the contract, the expected behaviours as numbered test rows (for example V1 to V64 for Day 3, S1 to S21 for Day 4) and the order of work. Each row became a test, so a task was finished when its rows passed. These files live in `docs/`, which is git-ignored by the author's choice, so they are not in the public repository.
- **One decision at a time.** Open choices (resubmit on the same order, flag-only wastage cap, `IN_SEWING`, decimal handling, status codes, plain-Postgres Supabase, auth design) were settled one by one in a decision log (`docs/DECISIONS.md`, also git-ignored) before code was written, and later contradictions were raised and asked about instead of silently picked.
- **Standing rules loaded by path**: `.claude/rules/gatekeeper-invariants.md`, `api-security.md`, `database.md`, `testing.md` and `ui-contrast.md` hold the invariants (roles, the state machine, traffic lights, the order of checks in every route, contrast rules). `CLAUDE.md` tells the assistant to ask before building anything ambiguous and to push back on risky requests.
- **Review gates.** A read-only reviewer agent for security and invariants and another for UI contrast were run on the changes that touched auth, the hard stop, migrations and screens; their findings were fixed in separate commits (for example `9eafb98`, `01bb8ed`, `817c88a`).
- **Evidence over claims.** Behaviour was checked in a real Chrome against a production build on a throwaway database (driven Chrome scripts for Days 2 to 4, which were not committed, and, from Day 4, the Playwright specs in `tests/e2e`), and new tests were checked by deliberately breaking the code and watching them fail (see the mutation entry in Section 2).
- **A running mistake log** (`AI_NOTES.md`, via the `log-ai-mistake` skill) so that Section 2 could be written from records made at the time.

The per-day task files (`docs/DAY1_DB_TASK.md` and the later plans) were written by Claude chat and reviewed by the author before each step was handed to Claude Code.

## 2. Flawed / Broken AI Code

Every entry below was caught and fixed; nothing here is hypothetical. Sources: the mistake log (`AI_NOTES.md`), the commits named, and the migrations and tests in the repository.

### 2.1 A CHECK that evaluates to NULL passed: a zero count could be approved (Day 1)

- **What was generated.** The first migrations enforced "a counted item's status matches its quantity" with a CHECK, and an approval guard that read the *stored* status flag.
- **Why it was wrong.** A CHECK that evaluates to `NULL` passes in PostgreSQL. A counted item with a `NULL` status therefore slipped through `chk_items_status_matches`, and because the approval guard trusted the stored status, a zero-count component with a `NULL` status could be approved: the hard stop was bypassable. This is recorded in the header of migration `20261013101447_fix_item_status_null` and commit `723e7d7`.
- **How it was found.** The records do not say how it was first noticed. The evidence is the header of migration `20261013101447_fix_item_status_null` and commit `723e7d7`, which describe the bypass and the fix.
- **Fix.** The CHECK now requires a status exactly when a count exists, and the approval guard recomputes shortages from the quantities (`actual_qty < expected_qty`) instead of trusting the stored flag. The same rule is repeated in the application (`approveOrder` in `src/lib/services/verification.ts` decides from quantities).
- **Lesson.** Never trust a stored flag for the hard stop; recompute from the facts. Treat `NULL` in a CHECK as a hole to test deliberately.

### 2.2 The approval guard counted rows, not the right rows (Day 1, found by hostile probing; fixed in `01bb8ed`)

- **What was generated.** SQL for "every component counted and none RED" that compared the *number* of item rows with the number of recipe components.
- **Why it was wrong.** An item for a component of another recipe could stand in for a missing one, and an item inserted with `expected_qty = 0` made any count GREEN. In the same guards: `btrim` only strips spaces, so notes made of tabs or no-break spaces passed the "non-blank" CHECK; the sewing guard checked the role but not `is_active`; and `target_qty` could change while an order was pending, leaving the items' `expected_qty` snapshots stale. All 79 Day 1 trigger tests had passed, because they only tried the cases the SQL was written for.
- **How it was found.** Probing the guards with hostile direct SQL after the tests were green. The 20 tests in `tests/db-triggers/guard-gaps.test.ts` failed 14 of 20 against the old schema.
- **Fix.** A new migration `20261014120000_fix_gatekeeper_guard_gaps` (applied migrations are never edited): the approval guard joins items to the order's recipe components, the item guard validates recipe, name and expected quantity on insert, the note CHECK needs a visible character, the sewing guard requires an active user, and the batch definition is immutable.
- **Lesson.** Tests written by the same author as the code share its blind spots; adversarial probing finds what they miss.

### 2.3 The fix itself was racy and its regex incomplete (found by the reviewer agent)

- **What was generated.** The corrected guards read the order row without a lock; the whitespace regex was written as raw invisible characters and missed NEL and zero-width characters.
- **Why it was wrong.** A RED count committed concurrently with an approval (which had read the old GREEN rows) produced a `VERIFIED` order with a RED item, reproduced with two sessions. The regex let a note of only invisible characters through.
- **How it was found.** The `gatekeeper-reviewer` agent flagged both by reading the SQL; two-connection tests then reproduced the race.
- **Fix.** `FOR UPDATE` on the order row in the approval guard and `FOR SHARE` in the item guard (order first, like the API), tests that fail without the locks (`tests/db-triggers/guard-gaps.test.ts`), and a regex written with `\u` escapes.
- **Lesson.** A security fix deserves its own review; concurrency needs a test with two real connections.

### 2.4 Logout or login racing a refresh could leave a live session (Day 2, `9eafb98`)

- **What was generated.** Refresh rotation was atomic, but family revocation was a separate plain `UPDATE ... WHERE family_id = ? AND revoked_at IS NULL`, assumed to cover every token in the family.
- **Why it was wrong.** Under READ COMMITTED a revoke that starts while a rotation is in flight never sees the successor token that rotation creates, so the user logs out yet a live refresh token survives.
- **How it was found.** The reviewer agent reasoned about Postgres semantics; a 25-round test (refresh in parallel with logout or login) then reproduced it: a live token survived in 5 to 6 rounds on every run.
- **Fix.** Rotation and revocation both take a per-family `pg_advisory_xact_lock` (`lockFamily` in `src/lib/auth/refresh.ts`). The race test passes on repeated runs.
- **Lesson.** Atomic is not the same as serialised.

### 2.5 The error wrapper swallowed Next.js control-flow errors (Day 2, `c8dd268`)

- **What was generated.** `handle()` turned every non-`ApiError` into a logged generic 500.
- **Why it was wrong.** Next.js signals "this route is dynamic" during prerender (and `redirect()`, `notFound()`) by throwing errors with a string `digest`. `GET /api/me` threw one during `next build`; the wrapper caught it, logged `[api] unhandled error` twice and returned a 500.
- **How it was found.** Two unexpected log lines in the build output, then a temporary debug print revealed the digest.
- **Fix.** `handle()` rethrows any error carrying a string `digest`; a regression test covers it.

### 2.6 Database error mapping assumed one error shape (Day 2, near-miss, `9dff550`)

- **What was generated.** A test helper read the SQLSTATE from `error.meta.code`, and that was copied into the production mapper.
- **Why it was wrong.** That is the shape of raw queries. The typed client reports trigger rejections as `PrismaClientUnknownRequestError` with the code inside a `PostgresError { code: "GK403" ... }` text, so every trigger rejection from `POST /api/orders` would have been a generic 500 instead of 403, 409 or 422.
- **How it was found.** A throwaway probe printed the real error shape before the mapper went into the order service; a mutation check later confirmed the regression test fails without the fix.
- **Fix.** `sqlStateOf` in `src/lib/db-errors.ts` parses both shapes, with tests for each and for a real trigger rejection through `handle()`.

### 2.7 Client-side guards that did not hold in a real browser (Day 2, `c1f5d4c`, `290a39f`)

- **Double submit.** "Submit is disabled while a request is in flight" was implemented with `setState`. Two clicks in one tick both ran the handler; a scripted double click in headless Chrome created **two** orders. Fixed with a synchronous `useRef` flag.
- **Sign out left the previous user's data in the tab.** Sign out and role switching used `router.replace` plus `router.refresh()`. Next keeps visited routes in the DOM, so the previous user's orders stayed in the tab on a shared terminal. Fixed with a full page load (`hardNavigate`) and a browser check that the old data is gone.
- **How both were found.** Real-browser runs, not unit tests.

### 2.8 Further entries from the log

| Entry | Why it was wrong | Found by | Fix |
|---|---|---|---|
| "`prisma generate` works without env vars" (`700874a`) | The check ran where `prisma.config.ts` silently loaded the real `.env`; in a clean checkout `env()` throws and fails `postinstall`, the build and CI | A dry run in a clean directory | Both URLs set at job level in CI; documented that Vercel needs both |
| A test command meant for the test database pointed at Supabase | Yarn 1 mangled the `--`, so `dotenv` never loaded `.env.test` (read-only command, nothing changed) | The output showed the Supabase host | Call the binaries directly and print the target host before anything that writes |
| Plain `{}` objects as lookup maps (`9eafb98`) | `constructor` or `__proto__` as a key resolved to inherited members and a field error was silently dropped | Reviewer, then a failing test | `Object.create(null)` and `Object.hasOwn` |
| A NUL byte in an order id gave a 500 (`9eafb98`) | Postgres rejects NUL in text | Reviewer, confirmed by a test | Ids are UUIDs; anything else is "not found" without a query |
| First unknown-email login was slower (`9eafb98`, since superseded) | A lazily created dummy hash made the first miss per instance twice as slow | Reviewer, then a test | The owner later removed the dummy comparison and moved from bcrypt to Argon2id (`d431140`, `0c3aaa9`) |
| A timing-dependent assertion in a Day 1 test (`1ee1ad6`) | `now()` can equal the stored value, so the "change" was a no-op | An intermittent failure | Update to `+ interval '1 second'` |

### 2.9 Day 3 and Day 4 audit findings

| Entry | Why it was wrong | Found by | Fix |
|---|---|---|---|
| Rejection-note rule looser than the database rule (`fa2dad4`) | `trim()` keeps NEL and zero-width characters, so such a note passed Zod, failed the DB CHECK and returned a 400 with no `fields.note` | Comparing the Day 3 task file with the code; a failing test | One shared `hasVisibleCharacter` rule used by schema and dialog |
| A `fixed` action bar floated 20px above the screen edge (`817c88a`) | Tailwind's `space-y` adds a bottom margin to every child but the last, and a fixed element honours it | A real-Chrome measurement at 375px | `mb-0` |
| Approve and Reject failures were drawn behind the open modal (`817c88a`) | A modal makes the page behind it inert, so a network or 500 error showed only a stopped spinner | The `ui-contrast-auditor` agent, by reading the code | A `dialogError` shown inside each dialog |
| The session was read outside `<Suspense>` on three pages (PR #6, `73d1465`) | Next 16's instant-navigation validation flagged it in `next dev`. The stack trace named `AppLayout` because `getSessionUser` is wrapped in `cache()` and the trace shows the first caller, so the cause was easy to misdiagnose. Production builds and 63 browser checks had never shown it | The author pasted the dev overlay; reproduced in a throwaway clone running `next dev`, 6 log entries before and 0 after | `RoleGate` moved inside the boundary |
| Mutation checks that did not mutate (Day 4) | A GNU-only `sed` range was silently ignored on macOS, and other edits were masked by deliberate extra layers (service re-assert, the queue's second status filter, the database trigger). "Still green" was not evidence | `git diff --stat` during the supposed mutation | Mutations applied with a script that asserts the pattern, on every layer; the matrix then failed as expected |
| Browser-run expectations that were wrong, not the app (Day 4) | The script assumed an empty database and mis-computed an over-cap figure | Recomputing by hand | Clear the data first; use a figure under the cap |

### 2.10 The deployed login returned 500: the Prisma engine was not found on the host (Day 4 deployment, PRs #9 and #11)

| Entry | Why it was wrong | Found by | Fix |
|---|---|---|---|
| Assumed the generated Prisma client would run on the serverless host because it ran locally (`b9081b5`) | Every database call returned 500, so the login form showed its generic "Could not sign in". The runtime log said `PrismaClientInitializationError: could not locate the Query Engine for runtime "rhel-openssl-3.0.x"`. The bundler rewrites `import.meta.url` in the generated client to a fake `/ROOT/...` directory and the build path baked in by `prisma generate` does not exist inside the function, so Prisma never searched the folder where the engine file lands. It only worked on the author's machine because the baked-in path happened to exist there | The author pasted the host's runtime log; I then reproduced it locally by building in one folder and running from another | Copy the Linux engine to `/tmp/prisma-engines`, a folder Prisma already searches, on a cold start (`src/lib/db.ts`) |
| First fix verified against the build output only (PR #9) | I added `binaryTargets` and `outputFileTracingIncludes` and checked that the trace JSON listed the engine, then reported it as the fix. It still failed in production because the trace was never the problem; the lookup path was. A trace listing is not evidence that the code runs | The author re-pasted the same error after the redeploy | Ran the built output in a Linux container against the real database: wrong password returned 401, a demo login returned 200 |
| Two fixes that the bundler silently removed | Setting `PRISMA_QUERY_ENGINE_LIBRARY` and guarding on `process.platform === "linux"` both compiled to nothing (the minifier dropped the assignment and folded the platform check at build time), so the tests on the built output still failed | Searching the built chunk for the code; the compiled file had no trace of it | Plain file-copy calls gated on `NODE_ENV`, confirmed present in the built chunk before the container run |

### 2.11 Transactions that passed every test and failed on the live site: too many round trips (Day 3 services, issue #29)

| Entry | Why it was wrong | Found by | Fix |
|---|---|---|---|
| Interactive transactions written as many small steps (`saveCounts` and the other mutations) | Saving counts did one `UPDATE` per component and then read the whole order back with Prisma's default nested loading (one query per relation), all inside the transaction: 14 statements, 12 of them between BEGIN and COMMIT. Each statement is a network round trip. On the author's machine and in CI the database is local, so it took milliseconds; from the host to a database in Singapore each trip cost hundreds of milliseconds and the transaction passed Prisma's 5 second limit (`P2028`, a 500). 858 tests, the browser checks and the real-Chrome runs all passed because none of them can see latency | The author saved counts on the live site and got a 500, then found `P2028` and the 6.8 s and 7.9 s durations in the function log | One batched `UPDATE ... FROM unnest(...)` (status still computed server-side), the response read moved after the commit with a one-query joined load, a 6 s transaction timeout and a 2 s connection wait, and `tests/api/round-trips.test.ts`, which caps every mutation at 8 statements (6 inside the transaction). The test was red first (14 > 8) |

## 3. Human Refactoring

Be precise about who did what. The assistant wrote the code under review; the author set the direction, made the decisions and accepted or rejected what the assistant proposed.

### Decisions and direction (the author)

From the decision log and the Claude Code session record:

- **Resubmit on the same order** with the next attempt number, keeping each attempt's items and decision (instead of a new order per re-cut).
- **Wastage over the cap is a flag, not a block**, so a valid GREEN batch can never fail on a second blocking rule.
- **Supabase used as plain PostgreSQL**: no client SDK, row level security on every table with no policies, runtime on the transaction pooler and migrations on the session pooler.
- **Custom JWT plus a rotating, hashed refresh token** with reuse detection, with the role re-read from the database on every request.
- **An `IN_SEWING` status and a separate active list**, so "Start Sewing Assembly" has a persistent effect while the queue stays a literal `WHERE status = 'VERIFIED'`.
- **Integer piece counts, two-decimal fabric**, and the status-code contract (400 versus 422).
- **Review gates**: reviewer agents before changes to auth, migrations and the hard stop, and the rule to ask rather than guess.

### Changes the owner directed after reviewing the AI's work

- Removed the dummy password comparison for unknown emails, accepting a known timing difference (`d431140`).
- Replaced bcrypt with Argon2id (`0c3aaa9`) and `fetch` with axios in the client helper (`ab6949e`).
- Centred the login form and removed the demo account cards from it (`33398a1`); the Role Switcher was kept at that point and later removed by the owner (PR #26).
- Kept `docs/` and `AI_NOTES.md` out of the repository, and had an accidental merge into `main` reverted (PR #3).
- Moved the Playwright specs under `tests/e2e`.
- Asked for the Day 1 SQL gaps to be fixed before building on them (`01bb8ed`).

### What the AI wrote versus what the author wrote by hand

Almost all of the code was written by the assistant under the process above. The author made only small hand edits (copy changes and a whitespace edit in `new-order-modal.tsx`); the decisions above were the author's, and the assistant implemented them. No claim of other hand-written code is made in this report.

### Structural refactors made during review

- A single `handle()` wrapper and a fixed order of checks in every route (`src/lib/api/handle.ts`) instead of per-route error handling.
- Services that take the authenticated user and re-assert the role (`src/lib/services/`), used by route handlers and server components alike, so a forgotten `requireRole` still fails.
- One validation module shared by the API and the form (`src/lib/validation/order.ts`), one `evaluateCount` and one wastage function shared by server and UI (`src/lib/domain/`), and one `listSewingQueue` shared by the endpoint, the page and brief Test 5.
- Guard SQL moved from "count the rows" to "join to the recipe's components" and from a stored flag to recomputed quantities (see 2.1 and 2.2).

## 4. Defensive Architecture

Drawn from the code, with file references. The hard stop is enforced twice on purpose: in the API and in PostgreSQL.

- **State machine.** `PENDING_VERIFICATION → VERIFIED | REJECTED`, `REJECTED → PENDING_VERIFICATION` (attempt + 1), `VERIFIED → IN_SEWING`, nothing else. Enforced in the database by `gk_order_update_guard` (`prisma/migrations/20261013094206_gatekeeper_constraints`, redefined in `20261014120000_fix_gatekeeper_guard_gaps`), which also requires an `APPROVED` log for the current attempt before `VERIFIED`.
- **API guard order.** Every route is `handle()` (`src/lib/api/handle.ts`): the `Origin` check first for mutations (`src/lib/api/origin.ts`), then `requireRole` (`src/lib/auth/session.ts`: 401, 403), strict Zod parsing (`src/lib/api/validate.ts`: unknown keys are 400), then the transaction that locks the order and checks scope and state (404, 409), then business rules (422), then the write. Wrong role is always 403 before any 404.
- **Row locking.** Every mutation locks the order row first with `SELECT ... FOR UPDATE` (`lockOrder` in `src/lib/services/verification.ts`, reused by `startSewing` in `src/lib/services/sewing.ts`), so lock order is identical everywhere. A second approval, reject or start waits, then gets a 409 before any business rule. Concurrency tests: `tests/api/verification-concurrency.test.ts` and the five-way start race in `tests/api/sewing.test.ts`.
- **Database triggers as a second wall.** `trg_log_insert_guard` (approval needs every component of the order's recipe counted and none short, and an active verifier), `trg_item_guard` (items match the recipe, name and expected quantity), `trg_order_insert_guard`, `trg_order_update_guard` (legal transitions, active sewing supervisor, immutable batch definition), `trg_logs_immutable` and `trg_items_frozen_after_decision`; plus CHECKs `chk_items_status_matches`, `chk_logs_reject_note` and `chk_logs_approve_snapshot`. Their behaviour is tested with raw SQL in `tests/db-triggers/`. A measured example of the layers: with both application role checks removed from the approve path, a supervisor was still refused, by `trg_log_insert_guard`.
- **Append-only audit.** `trg_logs_immutable` blocks `UPDATE` and `DELETE` on `verification_logs`; `trg_items_frozen_after_decision` freezes the items of a decided attempt; `UNIQUE (order_id, attempt_no)` allows one decision per attempt even under a race. No endpoint can edit history, and unsupported methods have no route (tested).
- **Server-derived identity and timestamps.** `verifierId` comes from the session, `decidedAt` from the column default (database clock), `sewing_started_by` from the session and `sewing_started_at` from `now()` in a guarded `UPDATE ... WHERE status = 'VERIFIED'` (`src/lib/services/verification.ts`, `src/lib/services/sewing.ts`). Item status, wastage and over-cap are computed by `evaluateCount` and `calculateWastage` (`src/lib/domain/`) on decimals, never from the request. Body schemas are strict, so those keys are rejected with 400.
- **The sewing queue.** `listSewingQueue` (`src/lib/services/sewing-queue.ts`) holds the only status filter as a constant, re-applies it when loading rows, joins the approving log of the current attempt, and ignores every query parameter except `limit`. The endpoint, the `/sewing` page and brief Test 5 call this one function. Sewing DTOs load only approved logs, so a rejection note or an earlier attempt cannot reach them (tests S8 and S9).
- **Row level security.** Enabled on all seven tables with no policies (`prisma/migrations/20261013094206_gatekeeper_constraints`); the Supabase Data API is not used, so `users.password_hash` has no public path.
- **CSRF and cookies.** `SameSite=Lax`, `HttpOnly`, `Secure` in production, and an `Origin` check on every mutating request (`src/lib/auth/cookies.ts`, `src/lib/api/origin.ts`).
- **Refresh rotation.** The refresh token is opaque and stored only as a SHA-256 hash with a `family_id`; every use rotates it, reuse of a rotated token revokes the whole family, and rotation and revocation of one family are serialised by an advisory lock (`rotateSession`, `revokeSession`, `lockFamily` in `src/lib/auth/refresh.ts`). The refresh cookie's path is `/api/auth`, so pages cannot read it.
- **Error hygiene.** SQLSTATEs map to 403, 409, 422 or 400 and anything else is a generic 500 (`src/lib/db-errors.ts`); responses use explicit selects, so hashes and token data cannot leak.
- **Tests as evidence.** As of the last run: Vitest 869 tests in 28 files (plus 55 Playwright checks: the evaluator path and automated contrast) (database triggers, route handlers called with real session cookies, domain and client logic), including `tests/api/brief-required.test.ts` (brief Tests 1 to 5), a table-driven RBAC matrix over every endpoint and every role (`tests/api/rbac-matrix.test.ts`) and a full-flow test (`tests/api/full-flow.test.ts`); and 55 Playwright tests in `tests/e2e` (the evaluator path and an automated contrast sweep over six pages and their dialogs at three widths in light and dark emulation). Re-run `yarn test` and `yarn e2e` to confirm the current numbers; CI runs lint, type-check, migrations, the suite and the production build on every push.

