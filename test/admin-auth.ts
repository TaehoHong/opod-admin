import type { INestApplication } from "@nestjs/common";
import request from "supertest";

export async function adminHeaders(app: INestApplication) {
  const response = await request(app.getHttpServer())
    .post("/api/admin/login")
    .send({ email: "admin@example.test", password: "test-password-1" })
    .expect(201);

  return { authorization: `Bearer ${response.body.token}` };
}
