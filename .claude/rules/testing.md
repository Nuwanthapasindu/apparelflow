---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing rules

Runner: Vitest via `yarn test`, which loads `.env.test` and points at a **separate local test Postgres** (never Supabase). Reset between tests with `TRUNCATE ... CASCADE`, never `DELETE` (the append-only triggers block it).

## The five tests from the brief (must pass)
1. An order with all GREEN components can be approved by an authenticated Verifier.
2. An order with at least one RED component blocks approval and returns an error (422).
3. Rejecting without a reason note is rejected by backend validation.
4. Non-verifier roles receive 403 when attempting approval.
5. Unapproved orders never appear in the Sewing Queue database query (also assert `IN_SEWING` orders are absent).

## Additional API tests
Double-approve of the same attempt returns 409. Missing and uncounted components return 422. Client-supplied `verifier_id`, `status` or `wastage_pct` in the body is ignored or rejected. Decimal piece counts and `""`, `" "`, `1e3`, `-1`, `null` inputs are rejected. Resubmit increments the attempt and keeps the old attempt's rows. Wastage is flag-only: an over-cap GREEN batch still approves, with `over_cap = true`. Auth: rotated refresh token cannot be reused; reuse revokes the whole family; expired refresh token returns 401.

## Domain unit tests (pure functions, no DB)
Component multiplier (50 garments x 2 cuffs = 100), traffic-light status for actual below, equal to and above expected (including 0), wastage % with rounding and negative values.

## DB trigger tests (raw SQL, each must throw)
`APPROVED` log with a RED item, with an uncounted item, and with a missing component row. Order set to `VERIFIED` without an APPROVED log. Illegal transitions (`VERIFIED -> PENDING_VERIFICATION`, `REJECTED -> VERIFIED`, `IN_SEWING -> VERIFIED`). `UPDATE` or `DELETE` on `verification_logs`. Item edit after a decision exists. Log with a stale `attempt_no`. Log by a non-verifier. Order created by a non-supervisor. Edit of `target_qty` on a verified order.

## Style
Write the happy path and the rejection/hard-stop path for every status transition. Assert exact HTTP status codes and error codes. Prefer testing through the real route handlers with a real session cookie over mocking `requireRole`.
