import { loadAppConfig } from "./app-config";

const required = {
  DATABASE_URL: "postgresql://localhost/opod",
  ADMIN_JWT_SECRET: "test-secret",
};

describe("loadAppConfig", () => {
  // 자동 루프 on/off는 여기 없다 — admin_settings가 소유한다
  // (GenerationSettingsService.resolveWorkerToggles).
  it("preserves worker defaults and parses explicit overrides", () => {
    const defaults = loadAppConfig(required);
    expect(defaults.worker).toMatchObject({
      pollIntervalMs: 15_000,
      maxAttempts: 3,
      dailyBudgetUsd: undefined,
    });
    expect(defaults.draftWorker).toEqual({
      pollIntervalMs: 15_000,
      planLeaseSeconds: 120,
      maxAttempts: 3,
      maxShots: 2,
      schedulerEnabled: false,
    });

    const configured = loadAppConfig({
      ...required,
      WORKER_POLL_INTERVAL_MS: "1000",
      WORKER_MAX_ATTEMPTS: "5",
      WORKER_DAILY_BUDGET_USD: "10",
      DRAFT_PLAN_LEASE_SECONDS: "30",
      DRAFT_MAX_ATTEMPTS: "6",
      DRAFT_MAX_SHOTS: "3",
      DRAFT_SCHEDULER_ENABLED: "1",
    });
    expect(configured.worker).toMatchObject({
      pollIntervalMs: 1000,
      maxAttempts: 5,
      dailyBudgetUsd: 10,
    });
    expect(configured.draftWorker).toEqual({
      pollIntervalMs: 1000,
      planLeaseSeconds: 30,
      maxAttempts: 6,
      maxShots: 3,
      schedulerEnabled: true,
    });
  });

  it("exposes S3 only when the complete signer configuration is present", () => {
    expect(
      loadAppConfig({ ...required, S3_BUCKET: "partial" }).s3,
    ).toBeUndefined();
    expect(
      loadAppConfig({
        ...required,
        S3_BUCKET: " bucket ",
        AWS_REGION: " us-east-1 ",
        AWS_ACCESS_KEY_ID: " access ",
        AWS_SECRET_ACCESS_KEY: " secret ",
        S3_PUBLIC_BASE_URL: " https://cdn.example.com ",
      }).s3,
    ).toEqual({
      bucket: "bucket",
      region: "us-east-1",
      accessKeyId: "access",
      secretAccessKey: "secret",
      publicBaseUrl: "https://cdn.example.com",
    });
  });
});
