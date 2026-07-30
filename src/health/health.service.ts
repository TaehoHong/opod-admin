import { Injectable } from "@nestjs/common";
import { HealthRepository } from "./health.repository";

export type HealthStatus = {
  status: "ok" | "degraded";
  database: "up" | "down";
};

// 배포 후 수동 확인(docs/03-deployment-rules.md "Manual Deployment Flow" 6단계)
// 중 DB 연결 확인을 자동화한다. 운영 정보를 노출하지 않도록 up/down만 돌려준다.
@Injectable()
export class HealthService {
  constructor(private readonly health: HealthRepository) {}

  async check(): Promise<HealthStatus> {
    const databaseReachable = await this.health.isDatabaseReachable();
    return {
      status: databaseReachable ? "ok" : "degraded",
      database: databaseReachable ? "up" : "down",
    };
  }
}
