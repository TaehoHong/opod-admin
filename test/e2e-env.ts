import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminApiKey } from "./admin-auth";

const envFile = JSON.parse(
  readFileSync(join(__dirname, ".tmp", "e2e-db.json"), "utf8"),
) as { DATABASE_URL?: string };

if (!envFile.DATABASE_URL) {
  throw new Error("Testcontainers DATABASE_URL was not created");
}

process.env.DATABASE_URL = envFile.DATABASE_URL;
process.env.ADMIN_API_KEY = adminApiKey;
process.env.AUTH_JWT_SECRET = "test-auth-secret";
process.env.S3_BUCKET = "ai-sns-test";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test-access";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.com";
