import { readFileSync } from "node:fs";
import { join } from "node:path";

const envFile = JSON.parse(
  readFileSync(join(__dirname, ".tmp", "e2e-db.json"), "utf8"),
) as { DATABASE_URL?: string };

if (!envFile.DATABASE_URL) {
  throw new Error("Testcontainers DATABASE_URL was not created");
}

process.env.DATABASE_URL = envFile.DATABASE_URL;
process.env.AUTH_JWT_SECRET = "test-auth-secret";
// 최초 관리자는 bootstrap 환경변수로만 생성된다 (test/admin-auth.ts가 이 값으로
// 로그인한다).
process.env.ADMIN_BOOTSTRAP_EMAIL = "admin@example.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "test-password-1";
process.env.S3_BUCKET = "ai-sns-test";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test-access";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.com";
