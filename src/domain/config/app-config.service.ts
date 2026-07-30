import { Injectable } from "@nestjs/common";
import { AppConfig, ConfigEnv, loadAppConfig } from "./app-config";

// 주입 가능한 typed config. 생성 시점에 검증하므로 필수 설정이 빠지면
// Nest 부팅이 실패한다 (docs/02-development-rules.md:137).
@Injectable()
export class AppConfigService {
  private readonly config: AppConfig;

  constructor(env?: ConfigEnv) {
    this.config = loadAppConfig(env);
  }

  get databaseUrl(): string {
    return this.config.databaseUrl;
  }

  get adminJwtSecret(): string {
    return this.config.adminJwtSecret;
  }

  get port(): number {
    return this.config.port;
  }

  get tls(): AppConfig["tls"] {
    return this.config.tls;
  }

  get bootstrapAdmin(): AppConfig["bootstrapAdmin"] {
    return this.config.bootstrapAdmin;
  }
}
