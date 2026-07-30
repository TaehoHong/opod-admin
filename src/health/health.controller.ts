import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import { HealthService, HealthStatus } from "./health.service";

// 인증 없이 접근 가능한 liveness/readiness 경로. 모니터링과 배포 후 확인이
// 로그인 없이 상태를 읽을 수 있어야 하므로 AdminJwtGuard를 걸지 않는다.
@Controller("api/health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(200)
  async check(
    // express 타입 패키지를 새로 들이지 않기 위한 구조적 타입 (src/main.ts와 동일).
    @Res({ passthrough: true }) response: { status(code: number): void },
  ): Promise<HealthStatus> {
    const result = await this.health.check();
    // DB가 끊기면 503 — 로드밸런서/스크립트가 상태 코드만으로 판정할 수 있다.
    response.status(result.status === "ok" ? 200 : 503);
    return result;
  }
}
