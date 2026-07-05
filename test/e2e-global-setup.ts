import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const envFilePath = join(__dirname, ".tmp", "e2e-db.json");

type E2EGlobal = typeof globalThis & {
  __E2E_POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("ai_sns_test")
    .withUsername("ai_sns")
    .withPassword("ai_sns")
    .start();

  try {
    const databaseUrl = container.getConnectionUri();

    mkdirSync(dirname(envFilePath), { recursive: true });
    writeFileSync(envFilePath, JSON.stringify({ DATABASE_URL: databaseUrl }));

    execFileSync("npx", ["prisma", "db", "push"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });

    (globalThis as E2EGlobal).__E2E_POSTGRES_CONTAINER__ = container;
  } catch (error) {
    await container.stop();
    throw error;
  }
}
