// 애플리케이션 시작에 필요한 설정을 한 곳에서 읽고 검증한다.
// 일반 코드는 process.env를 직접 읽지 않고 AppConfigService를 주입한다
// (docs/02-development-rules.md "Validation, Errors, Config and Logs").
//
// 여기서 다루는 것은 프로세스 부팅에 필요한 값뿐이다. 생성 프로바이더
// 설정처럼 admin_settings(DB)가 env보다 우선하는 값은 런타임마다 재해석해야
// 하므로 GenerationSettingsService가 계속 소유한다.

export type ConfigEnv = Record<string, string | undefined>;

export type AppConfig = {
  databaseUrl: string;
  adminJwtSecret: string;
  port: number;
  tls?: { certPath: string; keyPath: string };
  bootstrapAdmin?: { email: string; password: string };
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
  };
}
