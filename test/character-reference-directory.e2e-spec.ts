import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { DatabaseService } from "../src/core/database/database.service";
import {
  characters,
  characterInfluencers,
  influencers,
} from "../src/core/database/schema";

describe("SNS reference directory with 125 characters", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
  const marker = `directory-${randomUUID()}`;
  const fixtures = Array.from({ length: 125 }, (_, i) => ({
    id: `eeeeeeee-eeee-4eee-8eee-${String(i + 1).padStart(12, "0")}`,
    publicId: `${marker}-${i}`,
    displayName:
      i === 0
        ? `${marker} 마지막_인물%`
        : i === 1
          ? `${marker} 마지막X인물다른`
          : `${marker} 인물 ${i}`,
    bio: "Directory fixture",
    status: "inactive" as const,
  }));
  const endpoint = "/api/admin/v1/character-reference-directory";

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
    const db = app.get(DatabaseService);
    await db.client.insert(characters).values(fixtures);
    const accounts = await db.client
      .insert(influencers)
      .values([
        {
          platform: "instagram",
          username: "directory_last",
          url: "https://www.instagram.com/directory_last/",
        },
        {
          platform: "instagram",
          username: "directory_second",
          url: "https://www.instagram.com/directory_second/",
        },
        {
          platform: "instagram",
          username: "directory_first",
          url: "https://www.instagram.com/directory_first/",
        },
      ])
      .returning();
    await db.client.insert(characterInfluencers).values([
      { characterId: fixtures[0].id, influencerId: accounts[0].id },
      { characterId: fixtures[0].id, influencerId: accounts[1].id },
      { characterId: fixtures[124].id, influencerId: accounts[2].id },
    ]);
  });

  afterAll(async () => {
    if (app) {
      await app
        .get(DatabaseService)
        .client.delete(characters)
        .where(
          inArray(
            characters.id,
            fixtures.map((c) => c.id),
          ),
        );
      await app.close();
    }
  });

  it("returns only 20 characters per page without duplicates and searches beyond the first 100", async () => {
    const first = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: marker, limit: 20 })
      .set(headers)
      .expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items[0].id).toBe(fixtures[124].id);
    expect(first.body.items[0].referenceLinks[0].url).toBe(
      "https://www.instagram.com/directory_first/",
    );
    const second = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: marker, limit: 20, cursor: first.body.nextCursor })
      .set(headers)
      .expect(200);
    expect(second.body.items).toHaveLength(20);
    expect(second.body.items[0].id).toBe(fixtures[104].id);
    expect(second.body.items[0].referenceLinks).toEqual([]);
    const found = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: "마지막_인물%", limit: 20 })
      .set(headers)
      .expect(200);
    expect(found.body.items.map((c: { id: string }) => c.id)).toEqual([
      fixtures[0].id,
    ]);
    expect(
      found.body.items[0].referenceLinks.map(
        (link: { url: string }) => link.url,
      ),
    ).toEqual([
      "https://www.instagram.com/directory_last/",
      "https://www.instagram.com/directory_second/",
    ]);
    expect(found.body.nextCursor).toBeUndefined();
    const handle = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: `@${marker}-0` })
      .set(headers)
      .expect(200);
    expect(handle.body.items.map((c: { id: string }) => c.id)).toEqual([
      fixtures[0].id,
    ]);
  });

  it("filters registration before pagination, including a registered character beyond two candidate batches", async () => {
    const registered = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: marker, registration: "registered", limit: 20 })
      .set(headers)
      .expect(200);
    expect(registered.body.items.map((c: { id: string }) => c.id)).toEqual([
      fixtures[124].id,
      fixtures[0].id,
    ]);
    expect(registered.body.nextCursor).toBeUndefined();
    const missing = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: marker, registration: "missing", limit: 20 })
      .set(headers)
      .expect(200);
    expect(missing.body.items).toHaveLength(20);
    expect(missing.body.items[0].id).toBe(fixtures[123].id);
    expect(missing.body.items[19].id).toBe(fixtures[104].id);
    const excluded = await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: "마지막_인물%", registration: "missing" })
      .set(headers)
      .expect(200);
    expect(excluded.body.items).toEqual([]);
  });

  it("requires authentication and rejects invalid filters and cursors", async () => {
    await request(app.getHttpServer()).get(endpoint).expect(401);
    await request(app.getHttpServer())
      .get(endpoint)
      .query({ registration: "invalid" })
      .set(headers)
      .expect(400);
    await request(app.getHttpServer())
      .get(endpoint)
      .query({
        cursor: Buffer.from(JSON.stringify({ id: "not-a-uuid" })).toString(
          "base64url",
        ),
      })
      .set(headers)
      .expect(400);
    await request(app.getHttpServer())
      .get(endpoint)
      .query({ search: "x".repeat(101) })
      .set(headers)
      .expect(400);
  });
});
