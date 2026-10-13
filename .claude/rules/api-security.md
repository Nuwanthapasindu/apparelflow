---
paths:
  - "src/app/api/**"
  - "src/lib/**"
---

# API and server-side security rules

## Every route handler
Order of checks, always: **auth -> role -> validate body -> lock and check state -> business rules -> write**.
1. `requireRole(...)` first, in the handler itself. Next.js middleware is **not** a security boundary and may only be used for redirects. `requireRole` loads the user and role from the DB on every request; never trust a role claim in the token.
2. Parse the body with Zod `.strict()`. Reject unknown fields. Integers only for piece counts and target qty; `actual_qty = 0` is valid. Fabric yards is a **string** matched by `^\d{1,6}(\.\d{1,2})?$` and must be > 0. Never call `Number()` or `parseFloat()` on raw input (`Number("")` is 0). Reject `""`, `" "`, `1e3`, `NaN`, `-1`, `null`.
3. Inside a Prisma `$transaction`, lock the order row first: `SELECT ... FROM cutting_orders WHERE id = $1 FOR UPDATE`. Then check status and attempt (409), then business rules (422), then write.
4. Return clean errors from pre-checks. Database triggers are a backstop, not the primary path. Map leaked SQLSTATE `GK403`/`GK409`/`GK422` to 403/409/422 and Prisma `P2002` on `verification_logs(order_id, attempt_no)` to 409.

## Never trust the client
- `verifier_id`, `created_by`, `sewing_started_by`, timestamps, item `status`, `wastage_pct`, `over_cap`, `expected_qty` come from the session, the DB or server computation. If the body contains them, ignore them (and the strict schema should reject them).
- On approve, **recompute** item statuses from `actual_qty` and `expected_qty` in the DB. Do not trust previously stored flags or anything the client sent.

## Order creation, counts, decisions
- Creating an order inserts the order and one `verification_items` row per recipe component (`expected_qty = target_qty * pieces_per_garment`, `actual_qty = NULL`, with `component_name` snapshotted) in one transaction.
- Operation order in approve: lock -> save/verify counts -> insert `APPROVED` log -> update order to `VERIFIED`. Reject: insert `REJECTED` log (note required) -> update order to `REJECTED`. Resubmit: update order to `PENDING_VERIFICATION` with `current_attempt + 1` -> insert the new attempt's items.
- Sewing start: guarded `UPDATE ... SET status='IN_SEWING', sewing_started_by=<session>, sewing_started_at=now() WHERE id=$1 AND status='VERIFIED'`; zero rows changed returns 409.

## Sewing endpoints
`GET /api/sewing/queue` runs `WHERE status = 'VERIFIED'` and nothing else (no status query param). `GET /api/sewing/active` runs `WHERE status = 'IN_SEWING'`. Both sewing-supervisor only.

## Auth
Custom JWT access token (15 min, httpOnly cookie, only `sub` and expiry) plus opaque rotating refresh token (SHA-256 hash stored, `family_id`, reuse detection revokes the whole family). Cookies: `httpOnly`, `Secure`, `SameSite`. Same generic message for wrong email and wrong password. The Role Switcher calls the real login endpoint with the seeded demo credentials after revoking the current refresh family; it never flips client state. Details: `docs/GAPS_AND_STARTUP_GUIDE.md` section 5.

## Responses
Never return `password_hash` or token hashes. Shape error responses consistently (`{ error: { code, message, fields? } }`) so the UI can show inline errors.
