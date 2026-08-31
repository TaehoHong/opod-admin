import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/admin/auth/admin-session";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../src/domain/database/database.service";
import { media } from "../src/domain/database/schema";

describe("character profile image", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let headers: Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    const login = await request(app.getHttpServer())
      .post("/api/admin/v1/auth/login")
      .set(ADMIN_REQUEST_HEADER, "e2e")
      .send({ email: "admin@example.test", password: "test-password-1" })
      .expect(201);
    const cookie = String(login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    headers = {
      cookie,
      [ADMIN_REQUEST_HEADER]: "e2e",
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it("assigns, reads, validates, and clears a reusable profile image", async () => {
    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `profile-${randomUUID().slice(0, 8)}`,
        displayName: "Profile",
        bio: "Profile image test",
        interests: [],
      })
      .expect(201);

    const [image, video, pendingImage] = await Promise.all([
      database.client
        .insert(media)
        .values({
          mediaType: "image",
          url: "https://cdn.example/profile.png",
          width: 1200,
          height: 1600,
          uploadedAt: new Date(),
        })
        .returning()
        .then(([row]) => row),
      database.client
        .insert(media)
        .values({
          mediaType: "video",
          url: "https://cdn.example/profile.mp4",
          uploadedAt: new Date(),
        })
        .returning()
        .then(([row]) => row),
      database.client
        .insert(media)
        .values({
          mediaType: "image",
          url: "https://cdn.example/pending.png",
        })
        .returning()
        .then(([row]) => row),
    ]);

    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${character.body.id}/profile-image`)
      .set(headers)
      .expect(200)
      .expect({
        characterId: character.body.id,
        image: null,
        crop: { x: 0.5, y: 0.5, zoom: 1 },
      });

    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.body.id}/profile-image`)
      .set(headers)
      .send({
        mediaId: image.id,
        crop: { x: 0.2, y: 0.7, zoom: 2 },
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          characterId: character.body.id,
          image: {
            id: image.id,
            url: "https://cdn.example/profile.png",
            width: 1200,
            height: 1600,
          },
          crop: { x: 0.2, y: 0.7, zoom: 2 },
        });
      });

    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.body.id}/profile-image`)
      .set(headers)
      .send({ mediaId: video.id })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.body.id}/profile-image`)
      .set(headers)
      .send({ mediaId: pendingImage.id })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/admin/v1/characters/${character.body.id}/profile-image`)
      .set(headers)
      .expect(200)
      .expect({
        characterId: character.body.id,
        image: null,
        crop: { x: 0.5, y: 0.5, zoom: 1 },
      });

    await expect(
      database.client
        .select()
        .from(media)
        .where(eq(media.id, image.id))
        .limit(1)
        .then(([row]) => row ?? null),
    ).resolves.not.toBeNull();
  });
});
