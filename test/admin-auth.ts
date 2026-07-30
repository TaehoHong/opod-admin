import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_SESSION_COOKIE,
} from "../src/admin/auth/admin-session";

// 로그인은 세션을 HttpOnly cookie로만 돌려준다. 이후 요청은 그 cookie와
// 상태 변경용 고정 헤더를 함께 보내야 한다
// (docs/06-architecture.md "Authentication and Web Security").
export async function adminHeaders(app: INestApplication) {
  const response = await request(app.getHttpServer())
    .post("/api/admin/v1/auth/login")
    .set(ADMIN_REQUEST_HEADER, "1")
    .send({ email: "admin@example.test", password: "test-password-1" })
    .expect(201);

  const setCookie = response.headers["set-cookie"] as unknown as
    string[] | undefined;
  const session = (setCookie ?? []).find((cookie) =>
    cookie.startsWith(`${ADMIN_SESSION_COOKIE}=`),
  );
  if (!session) {
    throw new Error("Login did not set the admin session cookie");
  }

  return {
    cookie: session.split(";")[0],
    [ADMIN_REQUEST_HEADER]: "1",
  };
}
