import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { HealthController } from "./health.controller";
import { HealthRepository } from "./health.repository";
import { HealthService } from "./health.service";

async function createApp(databaseReachable: boolean) {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      HealthService,
      {
        provide: HealthRepository,
        useValue: {
          isDatabaseReachable: () => Promise.resolve(databaseReachable),
        },
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  await app.init();
  return app;
}

describe("HealthController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // 인증을 요구하게 되면 모니터링과 배포 후 확인이 조용히 끊긴다.
  it("reports ok without authentication when the database is reachable", async () => {
    app = await createApp(true);

    const response = await request(app.getHttpServer())
      .get("/api/health")
      .expect(200);

    expect(response.body).toEqual({ status: "ok", database: "up" });
  });

  // 항상 200을 주는 health 경로는 없는 것보다 나쁘다 — DB가 끊겨도
  // 정상으로 보인다.
  it("reports 503 and degraded when the database is unreachable", async () => {
    app = await createApp(false);

    const response = await request(app.getHttpServer())
      .get("/api/health")
      .expect(503);

    expect(response.body).toEqual({ status: "degraded", database: "down" });
  });
});
