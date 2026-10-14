# ApparelFlow Cutting Gatekeeper

Cutting operations and gatekeeper verification terminal for ApparelFlow ERP. No cutting batch can reach the Sewing Queue unless a Cutting Verifier has counted every component and signed off. The rule is enforced by the API and by PostgreSQL itself, not only by the UI.

## Demo accounts

Public demo logins with sample data only. Sign in on `/login`.

| Role | Email | Password | Can | Cannot |
|---|---|---|---|---|
| Cutting Supervisor | `cutting.supervisor@apparelflow.test` | `Demo-Supervisor-1` | Create cutting orders, log fabric used | Verify counts, see the Sewing Queue |
| Cutting Verifier | `cutting.verifier@apparelflow.test` | `Demo-Verifier-1` | Count components, approve or reject | Create orders, see the Sewing Queue |
| Sewing Supervisor | `sewing.supervisor@apparelflow.test` | `Demo-Sewing-1` | View verified batches, start sewing | See pending, unverified or rejected orders |

- The login page is a single centered email and password form. With `NEXT_PUBLIC_DEMO_MODE=true` the header also shows a **Role Switcher**. The Role Switcher signs out and signs in again through the real login endpoint, so the server-side session really changes.
- Without that flag there is no Role Switcher; sign out and sign in with another account instead.
- The accounts are created by the seed (`yarn prisma db seed`). Re-running the seed resets their passwords to the values above.
- Which pages exist per role today: Supervisor `/orders` (list, create, detail). Verifier `/verify` and Sewing `/sewing` are placeholders until the next milestone.

## Run locally

1. `yarn install` (this also runs `prisma generate`).
2. Create `.env` with `DATABASE_URL` (pooled runtime connection), `DIRECT_URL` (direct connection, used for migrations), `JWT_SECRET` (32 or more characters) and `NEXT_PUBLIC_DEMO_MODE=true`.
3. `yarn prisma migrate deploy`, then `yarn prisma db seed`.
4. `yarn dev` and open <http://localhost:3000>.

Tests run against a separate local Postgres, never the real database: see `CLAUDE.md` for the setup and `yarn test`.

## Deliberate interpretations and known limitations

Interpretations of the brief:

- **Wastage cap is flag only.** An over-cap batch shows an "OVER CAP" badge and still approves. The brief's hard stop is a RED, missing or uncounted component, and a second blocking rule could stop a valid batch.
- **Fabric yards are decimals** (greater than 0, at most 2 decimal places). Piece counts and target quantities are integers only.
- **`CUTTING_IN_PROGRESS` is unused.** It exists in the status enum to match the brief's diagram, but a new order starts as `PENDING_VERIFICATION`. There is no draft state.
- **A batch is immutable once created.** Recipe, target quantity, fabric roll and order number never change (enforced by a database trigger). Fabric yards can be corrected only while the order is rejected and being re-cut.

Known limitations of the authentication layer (accepted for this assessment):

- No rate limiting or lockout on login.
- An unknown email is rejected faster than a known one with a wrong password (no dummy hash comparison), so account existence can be inferred from timing.
- Logging out revokes the refresh token at once, but an access token already issued stays valid for up to 15 minutes.
- Refresh tokens slide for 7 days with no absolute lifetime cap, and expired token rows are not cleaned up.
- Two browser tabs refreshing at the very same moment can sign the user out (the second use of a rotated token counts as reuse).
- Creating an order has no idempotency key; the UI blocks double submits, but a client that retries a request after a timeout can create a second order.
