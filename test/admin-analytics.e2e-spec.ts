import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { adminHeaders } from "./admin-auth";

describe("admin analytics", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns analytics metrics for admins", async () => {
    await request(app.getHttpServer())
      .get("/admin/analytics")
      .set(adminHeaders)
      .query({ metric: "messages.count" })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          metrics: [{ name: "messages.count", value: expect.any(Number) }],
        });
      });
  });
});
