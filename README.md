# ApparelFlow Cutting Gatekeeper

Cutting operations and gatekeeper verification terminal for ApparelFlow ERP. No cutting batch can reach the Sewing Queue unless a Cutting Verifier has counted every component and signed off. The rule is enforced by the API and by PostgreSQL itself, not only by the UI.

## Demo accounts

Public demo logins with sample data only. Sign in on `/login`.

| Role | Email | Password | Can | Cannot |
|---|---|---|---|---|
| Cutting Supervisor | `cutting.supervisor@apparelflow.test` | `Demo-Supervisor-1` | Create cutting orders, log fabric used | Verify counts, see the Sewing Queue |
| Cutting Verifier | `cutting.verifier@apparelflow.test` | `Demo-Verifier-1` | Count components, approve or reject | Create orders, see the Sewing Queue |
| Sewing Supervisor | `sewing.supervisor@apparelflow.test` | `Demo-Sewing-1` | View verified batches, start sewing | See pending, unverified or rejected orders |

- With `NEXT_PUBLIC_DEMO_MODE=true` the login page shows these as one-click cards and the header shows a **Role Switcher**. The Role Switcher signs out and signs in again through the real login endpoint, so the server-side session really changes.
- Without that flag only the manual email and password form is shown.
- The accounts are created by the seed (`yarn prisma db seed`). Re-running the seed resets their passwords to the values above.
- Which pages exist per role today: Supervisor `/orders` (list, create, detail). Verifier `/verify` and Sewing `/sewing` are placeholders until the next milestone.

## Run locally

1. `yarn install` (this also runs `prisma generate`).
2. Create `.env` with `DATABASE_URL` (pooled runtime connection), `DIRECT_URL` (direct connection, used for migrations), `JWT_SECRET` (32 or more characters) and `NEXT_PUBLIC_DEMO_MODE=true`.
3. `yarn prisma migrate deploy`, then `yarn prisma db seed`.
4. `yarn dev` and open <http://localhost:3000>.

Tests run against a separate local Postgres, never the real database: see `CLAUDE.md` for the setup and `yarn test`.
