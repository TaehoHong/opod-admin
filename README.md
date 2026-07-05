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
