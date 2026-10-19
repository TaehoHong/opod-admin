import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
describe("character influencer mappings", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
  let first: string;
  let second: string;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/admin/v1/auth/login")
      .set(ADMIN_REQUEST_HEADER, "e2e")
      .send({ email: "admin@example.test", password: "test-password-1" })
      .expect(201);
    headers = {
      cookie: String(login.headers["set-cookie"]?.[0]).split(";")[0],
      [ADMIN_REQUEST_HEADER]: "e2e",
    };
  });
  beforeEach(async () => {
    const a = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({ publicId: randomUUID(), displayName: "A", bio: "test" })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({ publicId: randomUUID(), displayName: "B", bio: "test" })
      .expect(201);
    first = `/api/admin/v1/characters/${a.body.id}/influencers`;
    second = `/api/admin/v1/characters/${b.body.id}/influencers`;
  });
  afterAll(async () => {
    await app?.close();
  });
  it("shares accounts, deduplicates mappings and changes only the selected character", async () => {
    const a = await request(app.getHttpServer())
      .post(first)
      .set(headers)
      .send({ url: "https://www.instagram.com/Shared/" })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(second)
      .set(headers)
      .send({ url: "https://instagram.com/shared/" })
      .expect(201);
    expect(a.body.id).toBe(b.body.id);
    await request(app.getHttpServer())
      .post(first)
      .set(headers)
      .send({ url: "https://instagram.com/shared/" })
      .expect(201);
    expect(
      (await request(app.getHttpServer()).get(first).set(headers)).body,
    ).toHaveLength(1);
    const updated = await request(app.getHttpServer())
      .patch(`${first}/${a.body.id}`)
      .set(headers)
      .send({ url: "https://www.instagram.com/another/" })
      .expect(200);
    expect(updated.body.id).not.toBe(a.body.id);
    expect(
      (await request(app.getHttpServer()).get(second).set(headers)).body[0].url,
    ).toBe("https://www.instagram.com/shared/");
    await request(app.getHttpServer())
      .delete(`${first}/${a.body.id}`)
      .set(headers)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${first}/${updated.body.id}`)
      .set(headers)
      .expect(200);
    expect(
      (await request(app.getHttpServer()).get(second).set(headers)).body,
    ).toHaveLength(1);
  });
  it.each([
    "https://example.com/a",
    "https://instagram.com/p/ABC/",
    "https://instagram.com/reels/",
    "javascript:alert(1)",
  ])("rejects unsupported profile %s", async (url) => {
    await request(app.getHttpServer())
      .post(first)
      .set(headers)
      .send({ url })
      .expect(400);
  });
  it("requires authentication and CSRF header", async () => {
    await request(app.getHttpServer()).get(first).expect(401);
    await request(app.getHttpServer())
      .post(first)
      .set("cookie", headers.cookie)
      .send({ url: "https://instagram.com/test/" })
      .expect(403);
  });
});
