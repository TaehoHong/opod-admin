# AGENTS.md

## Project Scope

- Project: `opod-admin`
- Role: admin NestJS API plus admin UI/proxy.
- Owns admin API routes under `src/admin` and `src/characters`, currently
  mounted under `/api/*`.
- Approved API target is `/api/admin/v1/*`; migrate backend and UI together in
  a separate implementation task.
- Owns admin UI under `packages/admin`.
- Uses Prisma against the shared OPOD database.
- Does not own canonical database schema migrations; those belong to
  `opod-service-backend`.

## PAVE Workflow

- This repository uses PAVE: Plan, Approve, Verify, Execute.
- Use `$pave:pave` when available. Repo-local runtime lives under
  `.codex/pave/`.
- Read `.codex/pave/config.md` and the matching adapter before standard PAVE
  work.
- For code work, read `docs/07-codebase-guide.md` before broad source
  discovery. Inspect the target, direct dependencies, relevant tests, and
  named canonical examples first.
- Standard code or test edits require one consolidated approval immediately
  before implementation. Use the PAVE fast path only when all of its hard
  size, risk, and verification conditions are satisfied.
- Ask only about unresolved choices that materially affect product behavior,
  security, data, cost, permissions, contracts, or architecture. Decide minor
  reversible implementation details within approved project rules.
- During project initialization, decide project-wide policies only. Defer
  feature-specific details to that feature's implementation.
- Keep standard implementation plans under `.codex/pave/plans/` when a
  durable plan is useful.
- Update affected codebase-guide entries when verified work changes ownership,
  boundaries, canonical examples, test locations, or verification commands.

## Local Commands

- Runtime: Node.js 26 and npm
- Install: `npm install`
- Reproducible install: `npm ci`
- Prisma client: `npm run db:generate`
- Start admin API: `npm run start:dev`
- Start admin UI/API alias: `npm run admin:dev`
- Admin UI check: `npm run admin:check`
- Format: `npm run format`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- E2E tests: `npm run test:e2e`
- Schema mirror check: `npm run schema:check`
- Build: `npm run build`

## Testing Guidance

- Do not create meaningless tests.
- A meaningless test is one that does not increase confidence that real product
  or service behavior is protected from regressions.
- Every new test should be able to answer: "If this test fails, what real user
  behavior, API contract, permission rule, data state, error path, or business
  rule is broken?"
- Avoid tests that only raise coverage, assert that mocks or private
  implementation details were called, duplicate an existing guarantee, verify
  framework/library behavior, or snapshot output without a clear behavioral
  contract.
- Prefer focused tests around observable outcomes, API contracts, permissions,
  validation, state changes, database effects, error responses, and integration
  boundaries.
- UI-only changes normally require `npm run admin:check` and
  `npm run format`.
- General API or worker changes require `npm run lint`, `npm run test`, and
  `npm run build`.
- Auth, payment, permission, database state-transition, or API-contract changes
  require relevant focused tests and `npm run test:e2e`.
- Prisma mirror changes require `npm run schema:check` and
  `npm run db:generate`.

## Boundaries

- Do not add public service controllers here.
- Do not run production schema migrations from this repo.
- Public/user-facing service code belongs in `opod-service-backend`.
- Admin-facing moderation, payment, refund, and credit controls belong here;
  canonical schema changes still start in `opod-service-backend`.
- Current admin UI is static HTML/CSS/JavaScript. The approved target is
  React, TypeScript, Vite, Mantine, React Router, and TanStack Query.
- New database access belongs in entity repositories. Do not inject
  `PrismaService` into new controllers or application/domain services.
- Do not introduce a generic base repository.
- Prefer Prisma APIs, constraints, optimistic concurrency, and serializable
  transactions over Raw SQL. Keep justified Raw SQL exceptions in repositories
  and never use unsafe/string-built SQL.
- Keep pure LLM prompt construction under `prompts/`; network calls, parsing,
  persistence, and orchestration belong under `src/`.
