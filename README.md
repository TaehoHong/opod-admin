# opod-admin

Admin backend and admin UI for OPOD.

## Structure

- `src/<feature>/`: admin controllers, services, repositories, DTOs and unit tests
- `src/administration/`: general admin API and HTTP module wiring
- `src/generation/`: image generation jobs, workers and provider adapters
- `src/drafts/`: draft API and draft workers
- `src/post-production/`: post planning pipeline and runtime module wiring
- `src/core/`: configuration and database infrastructure; schema mirrors the backend
- `src/shared/`: filters, middleware and pure utilities
- `packages/admin/`: React admin UI (already organized by feature)
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
