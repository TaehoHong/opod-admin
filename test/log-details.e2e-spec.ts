import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/core/database/database.service";
import { characterActionLogs, characters } from "../src/core/database/schema";
import { adminHeaders } from "./admin-auth";

describe("action log detail API", () => {
  let app: INestApplication;
  let headers: Awaited<ReturnType<typeof adminHeaders>>;
  let logId: string;
  const characterId = randomUUID();
  const targetId = randomUUID();

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    headers = await adminHeaders(app);
    const database = app.get(DatabaseService);
    await database.client.insert(characters).values({
      id: characterId,
      publicId: `log-detail-${randomUUID()}`,
      displayName: "Log Detail Character",
      bio: "fixture",
      interests: [],
      updatedAt: new Date(),
    });
    const [log] = await database.client
      .insert(characterActionLogs)
      .values({
        id: 9007199254740993n,
        characterId,
        actionType: "GENERATION_JOB_FAILED",
        targetTable: "generation_jobs",
        targetId,
        reason: "공급자 응답 시간 초과\n결과를 확인하세요.",
        createdAt: new Date("2026-10-02T01:02:03.000Z"),
      })
      .returning();
    logId = log.id.toString();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the exact persisted record with a lossless bigint ID", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/admin/v1/character-action-logs/${logId}`)
      .set(headers)
      .expect(200);
    expect(response.body).toEqual({
      id: "9007199254740993",
      characterId,
      actionType: "GENERATION_JOB_FAILED",
      targetTable: "generation_jobs",
      targetId,
      reason: "공급자 응답 시간 초과\n결과를 확인하세요.",
      createdAt: "2026-10-02T01:02:03.000Z",
    });
  });

  it.each(["invalid", "0", "-1", "1.5", "9223372036854775808"])(
    "rejects invalid ID %s with 400",
    async (id) => {
      await request(app.getHttpServer())
        .get(`/api/admin/v1/character-action-logs/${id}`)
        .set(headers)
        .expect(400);
    },
  );

  it("returns 404 when the ID has no record", async () => {
    await request(app.getHttpServer())
      .get("/api/admin/v1/character-action-logs/9223372036854775807")
      .set(headers)
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe("액션 로그를 찾을 수 없습니다.");
      });
  });

  it("requires an admin session", async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/v1/character-action-logs/${logId}`)
      .expect(401);
  });
});
