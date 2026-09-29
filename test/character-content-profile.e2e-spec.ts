import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { DatabaseService } from "../src/core/database/database.service";
import {
  characters,
  characterContentProfiles,
  characterPersonas,
  characterActionLogs,
} from "../src/core/database/schema";
import { CharacterContentProfileService } from "../src/character-content-profiles/character-content-profile.service";
import { EMPTY_CONTENT_PROFILE } from "../src/character-content-profiles/character-content-profile";

describe("character content profile", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let headers: Record<string, string>;
  const id = randomUUID();
  const otherId = randomUUID();
  const path = `/api/admin/v1/characters/${id}/content-profile`;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    await database.client.insert(characters).values(
      [id, otherId].map((id) => ({
        id,
        publicId: `profile-${id}`,
        displayName: "Synthetic",
        bio: "달리기를 즐긴다.",
      })),
    );
    await database.client.insert(characterPersonas).values({
      characterId: id,
      title: "personality",
      content: "공통 성격은 차분하다.",
    });
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
  afterAll(async () => {
    await app?.close();
  });

  it("saves separately, scopes by character, clears explicitly, and preserves personas", async () => {
    expect(
      (await request(app.getHttpServer()).get(path).set(headers).expect(200))
        .body,
    ).toEqual(EMPTY_CONTENT_PROFILE);
    const values = {
      accountConcept: "러닝 중심, 가끔 커피",
      imageStyle: "생활 사진",
      captionStyle: "짧게",
      constraints: "협찬 금지",
    };
    expect(
      (
        await request(app.getHttpServer())
          .put(path)
          .set(headers)
          .send(values)
          .expect(200)
      ).body,
    ).toEqual(values);
    expect(
      (await request(app.getHttpServer()).get(path).set(headers).expect(200))
        .body,
    ).toEqual(values);
    expect(await app.get(CharacterContentProfileService).get(id)).toEqual(
      values,
    );
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/admin/v1/characters/${otherId}/content-profile`)
          .set(headers)
          .expect(200)
      ).body,
    ).toEqual(EMPTY_CONTENT_PROFILE);
    const detail = await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${id}`)
      .set(headers)
      .expect(200);
    expect(detail.body.personas).toEqual([
      expect.objectContaining({ content: "공통 성격은 차분하다." }),
    ]);
    expect(JSON.stringify(detail.body)).not.toContain(values.accountConcept);
    const logs = await database.client
      .select()
      .from(characterActionLogs)
      .where(eq(characterActionLogs.characterId, id));
    expect(logs).toContainEqual(
      expect.objectContaining({ actionType: "CONTENT_PROFILE_UPDATED" }),
    );
    await request(app.getHttpServer())
      .put(path)
      .set(headers)
      .send(EMPTY_CONTENT_PROFILE)
      .expect(200);
    expect(await app.get(CharacterContentProfileService).get(id)).toEqual(
      EMPTY_CONTENT_PROFILE,
    );
    expect(
      await database.client
        .select()
        .from(characterContentProfiles)
        .where(eq(characterContentProfiles.characterId, id)),
    ).toHaveLength(1);
  });

  it("rejects unauthenticated, incomplete, oversized and missing-character writes", async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .put(path)
      .set(ADMIN_REQUEST_HEADER, "e2e")
      .send(EMPTY_CONTENT_PROFILE)
      .expect(401);
    await request(app.getHttpServer())
      .put(path)
      .set(headers)
      .send({ accountConcept: "부분 저장" })
      .expect(400);
    await request(app.getHttpServer())
      .put(path)
      .set(headers)
      .send({ ...EMPTY_CONTENT_PROFILE, imageStyle: "x".repeat(10001) })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${randomUUID()}/content-profile`)
      .set(headers)
      .send(EMPTY_CONTENT_PROFILE)
      .expect(404);
  });

  it("enforces one profile per character and deletes it with its character", async () => {
    const disposableId = randomUUID();
    await database.client.insert(characters).values({
      id: disposableId,
      publicId: `disposable-${disposableId}`,
      displayName: "Disposable",
      bio: "",
    });
    await database.client
      .insert(characterContentProfiles)
      .values({ characterId: disposableId });
    await expect(
      database.client
        .insert(characterContentProfiles)
        .values({ characterId: disposableId }),
    ).rejects.toThrow();
    await expect(
      database.client
        .insert(characterContentProfiles)
        .values({ characterId: randomUUID() }),
    ).rejects.toThrow();
    await database.client
      .delete(characters)
      .where(eq(characters.id, disposableId));
    expect(
      await database.client
        .select()
        .from(characterContentProfiles)
        .where(eq(characterContentProfiles.characterId, disposableId)),
    ).toEqual([]);
  });
});
