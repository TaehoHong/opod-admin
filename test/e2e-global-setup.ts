import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "pg";

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

    const migrationsDirectory = join(
      __dirname,
      "fixtures",
      "legacy-migrations",
    );
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      for (const directory of readdirSync(migrationsDirectory).sort()) {
        const migrationPath = join(
          migrationsDirectory,
          directory,
          "migration.sql",
        );
        if (!existsSync(migrationPath)) continue;
        await client.query(readFileSync(migrationPath, "utf8"));
      }
    } finally {
      await client.end();
    }

    (globalThis as E2EGlobal).__E2E_POSTGRES_CONTAINER__ = container;
  } catch (error) {
    await container.stop();
    throw error;
  }
}
