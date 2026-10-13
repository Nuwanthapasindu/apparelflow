---
paths:
  - "prisma/**"
  - "src/lib/db*"
  - "tests/db-triggers/**"
---

# Database and migration rules

- **Prisma 6 only.** Datasource has `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`. Runtime `DATABASE_URL` is the Supabase transaction pooler (port 6543, `?pgbouncer=true`); `DIRECT_URL` is the session pooler (port 5432) used for migrations.
- Prisma `String @id` maps to Postgres **TEXT**, and enums are quoted PascalCase types (`"OrderStatus"`). In raw SQL and triggers compare enums with `::text`.
- **Never** run `prisma migrate reset` or `prisma db push`. Never edit a migration that has been applied; add a new one.
- Constraints Prisma cannot express (CHECKs, triggers, views, RLS) live in **raw SQL migrations** created with `yarn prisma migrate dev --create-only --name <name>`. Reference SQL is in `prisma/constraints.sql` and `docs/GAPS_AND_STARTUP_GUIDE.md` section 4. That SQL was a draft and is only trusted once it has run against a real Postgres and its trigger tests pass.
- Custom SQLSTATEs: `GK403` role, `GK409` state, `GK422` hard stop.
- **Append-only audit:** never write code that `UPDATE`s or `DELETE`s `verification_logs`, or changes `verification_items` after a decision. Tests clean up with `TRUNCATE ... CASCADE` on the **test** database, never `DELETE`, and never against Supabase.
- Snapshots are deliberate: `component_name` and `expected_qty` on items, and expected fabric, wastage cap and over-cap on the approval log. Never "refresh" them from the current recipe.
- Enable row level security (no policies) on every table. The Supabase Data API stays disabled; the app talks to Postgres only through Prisma.
- Seed (`prisma/seed.ts`) must be idempotent. Recipes: REC-BL01 Casual Blouse (1.8 yds, cap 5.00; Front Body 1, Back Body 1, Sleeves 2, Collar & Stand 1, Sleeve Cuffs 2) and REC-CT02 Crop Top (1.1 yds, cap 8.00; Front Chest 1, Back Support 1, Neck Binding 1, Hem Elastic Casing 1, Side Strap Accents 2). Three demo users, one per role, bcrypt-hashed clearly fake demo passwords.
- Money-like and measurement values are `Decimal`, never JS floats.
- Extension points to keep cheap: `attempt_no` (per-attempt evidence), `unit` column for fabric if metres are ever needed, a future `sewing_events` table. Do not build them now.
