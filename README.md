# opod-admin

Admin backend and admin UI for OPOD.

## Structure

- `src/admin`: `/api/*` NestJS API
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

The server owns `docker-compose.yml` and `.env`. Do not keep production
compose files in this repo or overwrite them during deploy.

```bash
./deploy.sh
```

This builds the Linux image locally, uploads it with the server deploy script,
and restarts only the `admin` service. Keep the 7100 listener, TLS certificate
paths, database URL, volumes, and shared Docker network in the server-local
`~/opod-admin/docker-compose.yml` and `.env`.
