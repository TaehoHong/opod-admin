# opod-admin

Admin backend and admin UI for OPOD.

## Structure

- `src/admin`: `/api/*` NestJS API
- `src/domain/database`: canonical Drizzle schema and database adapter
- `packages/admin`: dependency-free admin UI and proxy server
- `drizzle.config.ts`: Drizzle Kit configuration
- `test`: admin-only tests

## Local

Run the service database from `../opod-service-backend` first, then:

```bash
npm install
npm run schema:check
npm run start:dev
npm run admin:dev
```

`opod-service-backend` owns canonical schema changes and production migrations.

## Production

The server owns `docker-compose.yml` and `.env`. Do not keep production
compose files in this repo or overwrite them during deploy.

```bash
./deploy.sh
```

This sends the local build context to the VPS Docker daemon over SSH, builds the
Linux/amd64 image natively on the VPS, and restarts only the `admin` service.
Keep the 7100 listener, TLS certificate paths, database URL, volumes, and shared
Docker network in the server-local `~/opod-admin/docker-compose.yml` and `.env`.
