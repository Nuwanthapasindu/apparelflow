---
name: add-api-endpoint
description: Checklist workflow for adding or changing an API route handler in this project (orders, verification, sewing, auth) so it enforces RBAC, validation, state locking and server-side values correctly, with tests for the happy and rejection paths.
---

# Add or change an API endpoint

Read `.claude/rules/gatekeeper-invariants.md` and `.claude/rules/api-security.md` first. If the request is ambiguous about role, state transition or whether it touches the hard stop, ask a short clarifying question before writing code.

## Steps
1. **State the contract** in a few lines: method and path, which single role may call it, request body, responses (with status codes), which status transition (if any) it performs.
2. **Zod schema** in `src/lib/validation/`, `.strict()`, integers for counts, regex string for fabric yards, no `Number()` on raw input. No server-owned fields in the schema.
3. **Handler** in `src/app/api/...`: `requireRole(...)` first, then parse, then a `$transaction` that locks the order row (`FOR UPDATE`), checks status and attempt (409), checks business rules (422), then writes. Take identity and timestamps from the session and the DB.
4. **Domain logic** (multiplier, traffic light, wastage) goes in `src/lib/domain/` as pure functions; reuse them, do not re-implement.
5. **Error mapping:** pre-check and return clean 401/403/400/409/422; map any leaked SQLSTATE `GK403`/`GK409`/`GK422` and Prisma `P2002` as defined in the rules.
6. **Tests** in `tests/api/`: happy path, wrong role (403), unauthenticated (401), invalid input (400), illegal state (409), and the hard-stop path (422) where relevant. If it changes status, add or update the DB trigger test too.
7. **Abuse check:** try to break it as an evaluator would with cURL: wrong role, forged body fields, double submit, stale attempt. Note any gap.
8. Run `yarn lint`, `yarn prisma validate`, `yarn test`. Run the `gatekeeper-reviewer` subagent on the diff before committing.
9. Commit atomically with an imperative message. If AI-generated code needed fixing during this work, run `/log-ai-mistake`.
