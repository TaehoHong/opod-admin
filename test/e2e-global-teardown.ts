import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { rmSync } from "node:fs";
import { join } from "node:path";

type E2EGlobal = typeof globalThis & {
  __E2E_POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalTeardown(): Promise<void> {
  await (globalThis as E2EGlobal).__E2E_POSTGRES_CONTAINER__?.stop();
  rmSync(join(__dirname, ".tmp"), { recursive: true, force: true });
}
