# AGENTS.md

## Project Scope

- Project: `opod-admin`
- Role: admin NestJS API plus admin UI/proxy.
- Owns admin API routes under `src/admin` and `src/characters`, currently
  mounted under `/api/*`.
- Approved API target is `/api/admin/v1/*`; migrate backend and UI together in
  a separate implementation task.
- Owns admin UI under `packages/admin`.
- Uses Drizzle ORM against the shared OPOD database.
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
- Generate Drizzle migration: `npm run db:generate`
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
- Drizzle schema mirror changes require `npm run schema:check` and
  `npm run db:generate`.

## Mandatory Repository Dependency Rule

- 이 규칙은 `opod-service-backend`와 `opod-admin`의 절대 규칙이다.
- Repository는 테이블당 하나이며, A Repository에 의존할 수 있는 것은 A Domain Service뿐이다.
- B Domain Service는 A Repository에 접근할 때 반드시 A Domain Service를 거친다.
- Application / Facade / UseCase Service는 Domain Service만 조합하며 Repository를 직접 의존하지 않는다.
- Controller, Worker, Scheduler 및 다른 Repository의 직접 Repository 접근도 금지한다.
- Repository/DB client 노출, 직접 SQL, 동적 DI 조회로 이 경계를 우회하지 않는다.
- 트랜잭션을 공유할 때도 소유 Domain Service 경유 원칙을 지킨다.
- 기존 미준수 코드는 예외나 정본 예시가 아니다. 요청 범위 밖 코드는 자동 수정하지 않는다.
- 상세 정본: [개발 규칙](docs/02-development-rules.md)의 “Repository 의존 절대 규칙”.

## Boundaries

- Do not add public service controllers here.
- Do not run production schema migrations from this repo.
- Public/user-facing service code belongs in `opod-service-backend`.
- Admin-facing moderation, payment, refund, and credit controls belong here;
  canonical schema changes still start in `opod-service-backend`.
- Current admin UI is static HTML/CSS/JavaScript. The approved target is
  React, TypeScript, Vite, Mantine, React Router, and TanStack Query.
- New database access belongs in entity repositories. Do not inject
  `DatabaseService` into new controllers or application/domain services.
- Do not introduce a generic base repository.
- Prefer Drizzle query builders, constraints, optimistic concurrency, and
  serializable transactions over Raw SQL. Keep justified Raw SQL exceptions in repositories
  and never use unsafe/string-built SQL.
- Keep pure LLM prompt construction under `prompts/`; network calls, parsing,
  persistence, and orchestration belong under `src/`.
