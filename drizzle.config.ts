import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/domain/database/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["opod"],
  tablesFilter: ["*"],
  introspect: { casing: "camel" },
});
