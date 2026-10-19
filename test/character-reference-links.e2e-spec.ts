import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { DatabaseService } from "../src/core/database/database.service";
import { sql } from "drizzle-orm";

describe("character reference links", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
  let path: string;
  let otherPath: string;

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
      cookie: String(login.headers["set-cookie"]?.[0] ?? "").split(";")[0],
      [ADMIN_REQUEST_HEADER]: "e2e",
    };
  });

  beforeEach(async () => {
    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `links-${randomUUID()}`,
        displayName: "Links",
        bio: "Test",
      })
      .expect(201);
    const other = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `links-${randomUUID()}`,
        displayName: "Other",
        bio: "Test",
      })
      .expect(201);
    path = `/api/admin/v1/characters/${character.body.id}/reference-links`;
    otherPath = `/api/admin/v1/characters/${other.body.id}/reference-links`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("persists multiple links, updates one and deletes only the selected link", async () => {
    await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200)
      .expect([]);
    const first = await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url: " https://EXAMPLE.com/motif " })
      .expect(201);
    expect(first.body).toEqual({
      id: expect.stringMatching(/^[1-9][0-9]*$/),
      characterId: path.split("/")[5],
      url: "https://example.com/motif",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const second = await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url: "https://example.org/reference" })
      .expect(201);
    const updated = await request(app.getHttpServer())
      .patch(`${path}/${first.body.id}`)
      .set(headers)
      .send({ url: "https://example.com/updated" })
      .expect(200);
    expect(updated.body.url).toBe("https://example.com/updated");
    const list = await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200);
    expect(list.body).toEqual([updated.body, second.body]);
    await request(app.getHttpServer())
      .delete(`${path}/${first.body.id}`)
      .set(headers)
      .expect(200)
      .expect({ id: first.body.id });
    await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200)
      .expect([second.body]);
  });

  it("rejects duplicate URLs within a character and allows them for another character", async () => {
    await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url: "https://example.com/" })
      .expect(201);
    await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url: "https://EXAMPLE.com" })
      .expect(409);
    const second = await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url: "https://example.org/" })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${path}/${second.body.id}`)
      .set(headers)
      .send({ url: "https://example.com/" })
      .expect(409);
    await request(app.getHttpServer())
      .post(otherPath)
      .set(headers)
      .send({ url: "https://example.com/" })
      .expect(201);
  });

  it("cannot read, update or delete a link through another character", async () => {
    const link = await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url: "https://example.com/" })
      .expect(201);
    await request(app.getHttpServer())
      .get(otherPath)
      .set(headers)
      .expect(200)
      .expect([]);
    await request(app.getHttpServer())
      .patch(`${otherPath}/${link.body.id}`)
      .set(headers)
      .send({ url: "https://example.org/" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${otherPath}/${link.body.id}`)
      .set(headers)
      .expect(404);
    await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200)
      .expect([link.body]);
  });

  it.each([
    "",
    "not-a-url",
    "javascript:alert(1)",
    "ftp://example.com/",
    "https://example.com/" + "x".repeat(2048),
  ])("rejects an invalid or non-HTTP URL: %s", async (url) => {
    await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({ url })
      .expect(400);
    await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200)
      .expect([]);
  });

  it("requires administrator authentication and the existing CSRF header", async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .post(path)
      .set("cookie", headers.cookie)
      .send({ url: "https://example.com/" })
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${randomUUID()}/reference-links`)
      .set(headers)
      .expect(404);
  });

  it("returns a BIGINT ID beyond JavaScript's safe integer range without rounding", async () => {
    await app.get(DatabaseService).client.execute(sql`
      INSERT INTO opod.character_reference_links(id, character_id, url)
      OVERRIDING SYSTEM VALUE
      VALUES (9007199254740993, ${path.split("/")[5]}, 'https://example.com/large-id')
    `);
    const response = await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200);
    expect(response.body[0].id).toBe("9007199254740993");
    await request(app.getHttpServer())
      .delete(`${path}/9007199254740993`)
      .set(headers)
      .expect(200);
  });

  it.each(["0", "1.2", "9223372036854775808", "invalid"])(
    "rejects an invalid BIGINT link ID: %s",
    async (id) => {
      await request(app.getHttpServer())
        .delete(`${path}/${id}`)
        .set(headers)
        .expect(400);
    },
  );
});
