# opod-admin

Admin backend and admin UI for OPOD.

## Structure

- `src/admin`: `/admin/*` NestJS API
- `src/domain/database`: Prisma database adapter only
- `packages/admin`: dependency-free admin UI and proxy server
- `prisma`: schema mirror for Prisma client generation
- `test`: admin-only tests

## Local

Run the service database from `../opod-service-backend` first, then:

```bash
npm install
npm run db:generate
npm run start:dev
npm run admin:dev
```

`opod-service-backend` owns schema changes and `db:push`.

## Production

Run the admin API privately, then expose the UI server:

```bash
ADMIN_API_PORT=7101 DATABASE_URL='postgresql://postgres:change-me@localhost:5432/postgres?schema=opod' npm run start:prod
PORT=7100 API_BASE_URL=http://localhost:7101 npm run start:ui
```
