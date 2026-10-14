# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Early scaffold: the app is still the unmodified `create-next-app` starter (`src/app/page.tsx`, `layout.tsx`) with Prisma wired up but no models, routes, or tests yet. Dependencies (`bcryptjs`, `jose`, `zod`, `@prisma/client`) point to a planned auth + database app, but none of it is implemented — don't assume it exists.

## Next.js version caveat

`AGENTS.md` warns that this Next.js (16.x, React 19.3) has breaking changes from what you may know. Before writing Next.js code, read the relevant guide under `node_modules/next/dist/docs/01-app/` (e.g. the Cache Components, prefetching, and authentication guides). Heed deprecation notices. Note `layout.tsx` already uses the global `LayoutProps<"/">` type helper rather than hand-written prop types.

`next.config.ts` enables `cacheComponents` and `partialPrefetching`, and routes `*.css` through `@tailwindcss/turbopack` (Tailwind v4, imported via `@import "tailwindcss"` in `globals.css`; no `tailwind.config`). Cache Components changes how dynamic data access and caching behave in the App Router, so check the docs before fetching data or reading request APIs.

## Commands

```bash
yarn dev          # next dev
yarn build        # next build
yarn start        # next start
yarn lint         # eslint (flat config: next core-web-vitals + typescript)
npx tsc --noEmit  # type-check (no script defined)
npx prisma generate        # regenerate the client into src/generated/prisma
npx prisma migrate dev     # create/apply migrations (uses DIRECT_URL-style session connection, see below)
```

`vitest` and `vite-tsconfig-paths` are installed as devDependencies, but there is no vitest config, no `test` script, and no test files yet. Single test (once added): `npx vitest run path/to/file.test.ts`.

Both `yarn.lock` and `package-lock.json` exist; the repo was last installed with yarn, so use yarn and keep the lockfiles from diverging.

## Database (Prisma 6 + PostgreSQL)

- `prisma/schema.prisma` uses the `prisma-client` generator with output `src/generated/prisma` (git-ignored). Import the client from there (`@/generated/prisma/...`), not from `@prisma/client`, and run `prisma generate` after cloning or changing the schema.
- `prisma.config.ts` loads `.env` via `dotenv/config` and reads `DATABASE_URL`. It sets `engine: "classic"`, and migrations go in `prisma/migrations`.
- `.env.example` documents two connection strings: `DATABASE_URL` (transaction-mode pooler, for runtime) and `DIRECT_URL` (session-mode pooler, for migrations). Only `DATABASE_URL` is currently referenced by the schema and config; `DIRECT_URL` is not wired in. The file also has no `=` after the variable names, so fill in real values in `.env` (git-ignored) rather than copying it as-is.

## Conventions

- Path alias `@/*` → `src/*`.
- TypeScript is `strict`; the App Router lives in `src/app`.
