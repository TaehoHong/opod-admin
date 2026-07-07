# AGENTS.md

## Project Scope

- Project: `opod-admin`
- Role: admin NestJS API plus admin UI/proxy.
- Owns `/admin/*` routes under `src/admin`.
- Owns admin UI under `packages/admin`.
- Uses Prisma against the shared OPOD database.
- Does not own canonical database schema migrations; those belong to
  `opod-service-backend`.

## Local Commands

- Install: `npm install`
- Prisma client: `npm run db:generate`
- Start admin API: `npm run start:dev`
- Start admin UI: `npm run admin:dev`
- Admin UI check: `npm run admin:check`
- Format: `npm run format`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- E2E tests: `npm run test:e2e`
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

## Boundaries

- Do not add public service controllers here.
- Do not run production schema migrations from this repo.
- Public/user-facing service code belongs in `opod-service-backend`.
