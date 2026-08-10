// 애플리케이션 시작에 필요한 설정을 한 곳에서 읽고 검증한다.
// 일반 코드는 process.env를 직접 읽지 않고 AppConfigService를 주입한다
// (docs/02-development-rules.md "Validation, Errors, Config and Logs").
//
// 여기서 다루는 것은 프로세스 부팅에 필요한 값뿐이다. 생성 프로바이더
// 설정처럼 admin_settings(DB)가 env보다 우선하는 값은 런타임마다 재해석해야
// 하므로 GenerationSettingsService가 계속 소유한다.

export type ConfigEnv = Record<string, string | undefined>;

export type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
};

// 자동 루프 on/off는 여기 없다 — admin_settings(DB)가 소유하고 워커가 tick마다
// 재해석한다 (GenerationSettingsService.resolveWorkerToggles).
export type GenerationWorkerConfig = {
  pollIntervalMs: number;
  jobsPerTick: number;
  leaseSeconds: number;
  maxAttempts: number;
  providerPollIntervalMs: number;
  providerTimeoutMs: number;
  candidateCount: number;
  dailyBudgetUsd?: number;
  jobCostEstimateUsd: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
};

export type DraftWorkerConfig = {
  pollIntervalMs: number;
  planLeaseSeconds: number;
  maxAttempts: number;
  maxShots: number;
  schedulerEnabled: boolean;
};

// 평가 워커 (docs/plan-prompt-evaluation-agent.md). lease 단위는 기존
// 관례대로 초.
export type EvaluationWorkerConfig = {
  pollIntervalMs: number;
  leaseSeconds: number;
  maxAttempts: number;
};

export type AppConfig = {
  databaseUrl: string;
  adminJwtSecret: string;
  port: number;
  tls?: { certPath: string; keyPath: string };
  bootstrapAdmin?: { email: string; password: string };
  s3?: S3Config;
  worker: GenerationWorkerConfig;
  draftWorker: DraftWorkerConfig;
  evaluationWorker: EvaluationWorkerConfig;
};

const DEFAULT_PORT = 7100;
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 8;

// 필수 설정 누락이나 잘못된 형식은 startup failure다
// (docs/03-deployment-rules.md "Secrets").
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(env: ConfigEnv, ...names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  throw new ConfigError(`${names.join(" or ")} is required`);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || !raw.trim()) return DEFAULT_PORT;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`ADMIN_API_PORT must be a TCP port, got "${raw}"`);
  }
  return port;
}

// TLS는 cert와 key가 모두 있을 때만 켠다 — 한쪽만 주면 평문으로 조용히
// 떨어지는 대신 실패시킨다.
function parseTls(env: ConfigEnv): AppConfig["tls"] {
  const certPath = env.ADMIN_TLS_CERT_PATH?.trim();
  const keyPath = env.ADMIN_TLS_KEY_PATH?.trim();
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) {
    throw new ConfigError(
      "ADMIN_TLS_CERT_PATH and ADMIN_TLS_KEY_PATH must be set together",
    );
  }
  return { certPath, keyPath };
}

// bootstrap 값은 관리자 테이블이 비어 있을 때만 쓰인다. 형식 검증은 여기서
// 하되, "없으면 실패"는 실제로 계정을 만들어야 하는 시점에서 판정한다.
function parseBootstrapAdmin(env: ConfigEnv): AppConfig["bootstrapAdmin"] {
  const email = env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  const password = env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  if (!email && !password) return undefined;
  if (!email || !password) {
    throw new ConfigError(
      "ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be set together",
    );
  }
  if (!email.includes("@")) {
    throw new ConfigError("ADMIN_BOOTSTRAP_EMAIL is invalid");
  }
  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new ConfigError(
      `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`,
    );
  }
  return { email: email.toLowerCase(), password };
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function parseS3(env: ConfigEnv): S3Config | undefined {
  const bucket = env.S3_BUCKET?.trim();
  const region = env.AWS_REGION?.trim();
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  const publicBaseUrl = env.S3_PUBLIC_BASE_URL?.trim();
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
  };
}

function parseWorker(env: ConfigEnv): GenerationWorkerConfig {
  return {
    pollIntervalMs: parsePositiveNumber(env.WORKER_POLL_INTERVAL_MS) ?? 15_000,
    jobsPerTick: parsePositiveNumber(env.WORKER_JOBS_PER_TICK) ?? 1,
    leaseSeconds: parsePositiveNumber(env.WORKER_LEASE_SECONDS) ?? 600,
    maxAttempts: parsePositiveNumber(env.WORKER_MAX_ATTEMPTS) ?? 3,
    providerPollIntervalMs:
      parsePositiveNumber(env.WORKER_PROVIDER_POLL_INTERVAL_MS) ?? 5_000,
    providerTimeoutMs:
      parsePositiveNumber(env.WORKER_PROVIDER_TIMEOUT_MS) ?? 5 * 60_000,
    candidateCount: parsePositiveNumber(env.WORKER_CANDIDATE_COUNT) ?? 2,
    dailyBudgetUsd: parsePositiveNumber(env.WORKER_DAILY_BUDGET_USD),
    jobCostEstimateUsd:
      parsePositiveNumber(env.WORKER_JOB_COST_ESTIMATE_USD) ?? 0.2,
    circuitBreakerThreshold:
      parsePositiveNumber(env.WORKER_CIRCUIT_BREAKER_THRESHOLD) ?? 5,
    circuitBreakerCooldownMs:
      parsePositiveNumber(env.WORKER_CIRCUIT_BREAKER_COOLDOWN_MS) ?? 5 * 60_000,
  };
}

function parseDraftWorker(env: ConfigEnv): DraftWorkerConfig {
  return {
    pollIntervalMs: parsePositiveNumber(env.WORKER_POLL_INTERVAL_MS) ?? 15_000,
    planLeaseSeconds: parsePositiveNumber(env.DRAFT_PLAN_LEASE_SECONDS) ?? 120,
    maxAttempts: parsePositiveNumber(env.DRAFT_MAX_ATTEMPTS) ?? 3,
    maxShots: parsePositiveNumber(env.DRAFT_MAX_SHOTS) ?? 2,
    schedulerEnabled: enabled(env.DRAFT_SCHEDULER_ENABLED),
  };
}

function parseEvaluationWorker(env: ConfigEnv): EvaluationWorkerConfig {
  return {
    pollIntervalMs:
      parsePositiveNumber(env.EVALUATION_POLL_INTERVAL_MS) ?? 15_000,
    leaseSeconds: parsePositiveNumber(env.EVALUATION_LEASE_SECONDS) ?? 120,
    maxAttempts: parsePositiveNumber(env.EVALUATION_MAX_ATTEMPTS) ?? 3,
  };
}

export function loadAppConfig(env: ConfigEnv = process.env): AppConfig {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    // 기존 배포 호환: ADMIN_JWT_SECRET을 우선하고 AUTH_JWT_SECRET,
    // ADMIN_API_KEY 순으로 받아들인다.
    adminJwtSecret: required(
      env,
      "ADMIN_JWT_SECRET",
      "AUTH_JWT_SECRET",
      "ADMIN_API_KEY",
    ),
    port: parsePort(env.ADMIN_API_PORT ?? env.PORT),
    ...(parseTls(env) ? { tls: parseTls(env) } : {}),
    ...(parseBootstrapAdmin(env)
      ? { bootstrapAdmin: parseBootstrapAdmin(env) }
      : {}),
    ...(parseS3(env) ? { s3: parseS3(env) } : {}),
    worker: parseWorker(env),
    draftWorker: parseDraftWorker(env),
    evaluationWorker: parseEvaluationWorker(env),
  };
}
