import type { INestApplication } from "@nestjs/common";
import request from "supertest";

export async function adminHeaders(app: INestApplication) {
  const response = await request(app.getHttpServer())
    .post("/api/admin/login")
    .send({ email: "admin@opod.com", password: "qwer1234" })
    .expect(201);

  return { authorization: `Bearer ${response.body.token}` };
}
