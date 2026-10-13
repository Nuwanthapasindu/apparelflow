# Gatekeeper invariants (always apply)

These are the core business rules. Do not weaken or work around them, even if asked, and even to make a test pass.

## Roles
| Role | Can | Cannot |
|---|---|---|
| `cutting_supervisor` | Create orders, set qty, log fabric yards, resubmit a rejected order | Verify, access Sewing Queue |
| `cutting_verifier` | Enter component counts, approve, reject (with mandatory note) | Create orders, edit recipes, access Sewing Queue |
| `sewing_supervisor` | View VERIFIED queue and IN_SEWING list, start sewing | See pending, unverified or rejected orders |

## State machine (the only legal transitions)
`PENDING_VERIFICATION -> VERIFIED | REJECTED`, `REJECTED -> PENDING_VERIFICATION` (resubmit, `current_attempt + 1`), `VERIFIED -> IN_SEWING`.
New orders start as `PENDING_VERIFICATION`, attempt 1. `CUTTING_IN_PROGRESS` exists in the enum only to match the brief's diagram and is never used.

## Traffic lights (server-computed only)
`actual == expected` GREEN; `actual > expected` YELLOW (batch may proceed); `actual < expected` RED (approval blocked). `actual = 0` is valid and RED. A component with no count is "uncounted" and also blocks approval.

## Hard rules
1. Any RED, missing or uncounted component: approval returns **422**, enforced in the API and by the DB trigger.
2. Only `cutting_verifier` approves or rejects. Wrong role returns **403**, unauthenticated **401**.
3. Rejection requires a non-blank reason note. The API validates it (400) and the DB CHECK also enforces it.
4. The Sewing Queue query is literally `WHERE status = 'VERIFIED'` with no client-controlled status filter. `IN_SEWING` orders appear only in the separate active list.
5. Verifier id, timestamps, item status, wastage % and over-cap flag are computed on the server from the session and the DB. Ignore any such fields in request bodies.
6. `verification_logs` is append-only; `verification_items` are frozen once a decision exists for that attempt. Rejected attempts keep their rows, and a resubmit creates new rows with the next `attempt_no`.
7. Wastage % = `(actual_fabric - expected_fabric) / expected_fabric * 100`, where `expected_fabric = target_qty * std_fabric_yards`. Computed decimal-safe, rounded once to 2 dp, snapshotted on approval together with the recipe cap and `over_cap`. The cap is **flag only** and never blocks approval.
8. Frontend validation is a convenience only. Disabled buttons, hidden tabs and redirects are not security.

## Status codes
401 no session; 403 wrong role; 400 malformed or invalid input (including blank rejection note, decimal piece count); 409 illegal state or already decided; 422 business-rule violation (RED, missing or uncounted components).
