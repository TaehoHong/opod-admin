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

## Boundaries

- Do not add public service controllers here.
- Do not run production schema migrations from this repo.
- Public/user-facing service code belongs in `opod-service-backend`.
