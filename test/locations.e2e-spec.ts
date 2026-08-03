import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/admin/auth/admin-session";
import { PrismaService } from "../src/domain/database/prisma.service";

describe("location management", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let headers: Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
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
    await app.close();
  });

  it("filters by character, orders confirmed image references, and soft-deletes", async () => {
    const suffix = randomUUID().slice(0, 8);
    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `location-${suffix}`,
        displayName: "Location owner",
        bio: "Location test",
        interests: [],
      })
      .expect(201);
    const otherCharacter = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `location-other-${suffix}`,
        displayName: "Other owner",
        bio: "Location test",
        interests: [],
      })
      .expect(201);
    const created = await request(app.getHttpServer())
      .post("/api/admin/v1/locations")
      .set(headers)
      .send({
        characterId: character.body.id,
        locationKey: `gym-${suffix}`,
        displayName: "Gym",
        description: "Gym description",
        visualPrompt: "Gym prompt",
        negativePrompt: "Crowded",
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/admin/v1/locations?characterId=${character.body.id}`)
      .set(headers)
      .expect(200)
      .expect((response) => {
        expect(
          response.body.items.map((item: { id: string }) => item.id),
        ).toContain(created.body.id);
      });
    await request(app.getHttpServer())
      .get(`/api/admin/v1/locations?characterId=${otherCharacter.body.id}`)
      .set(headers)
      .expect(200)
      .expect((response) => {
        expect(
          response.body.items.map((item: { id: string }) => item.id),
        ).not.toContain(created.body.id);
      });

    const [first, second, video, pending] = await Promise.all([
      prisma.media.create({
        data: {
          mediaType: "image",
          url: `https://cdn.example/${suffix}-first.jpg`,
          uploadedAt: new Date(),
        },
      }),
      prisma.media.create({
        data: {
          mediaType: "image",
          url: `https://cdn.example/${suffix}-second.jpg`,
          uploadedAt: new Date(),
        },
      }),
      prisma.media.create({
        data: {
          mediaType: "video",
          url: `https://cdn.example/${suffix}.mp4`,
          uploadedAt: new Date(),
        },
      }),
      prisma.media.create({
        data: {
          mediaType: "image",
          url: `https://cdn.example/${suffix}-pending.jpg`,
        },
      }),
    ]);

    await request(app.getHttpServer())
      .put(`/api/admin/v1/locations/${created.body.id}/references`)
      .set(headers)
      .send({
        references: [
          { mediaId: second.id, description: "second" },
          { mediaId: first.id, description: "first" },
        ],
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.references).toMatchObject([
          { mediaId: second.id, sortOrder: 10, description: "second" },
          { mediaId: first.id, sortOrder: 20, description: "first" },
        ]);
      });
    await request(app.getHttpServer())
      .put(`/api/admin/v1/locations/${created.body.id}/references`)
      .set(headers)
      .send({ references: [{ mediaId: video.id, description: "video" }] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/admin/v1/locations/${created.body.id}/references`)
      .set(headers)
      .send({ references: [{ mediaId: pending.id, description: "pending" }] })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/admin/v1/locations/${created.body.id}`)
      .set(headers)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/admin/v1/locations/${created.body.id}`)
      .set(headers)
      .expect(400);
    await expect(
      prisma.media.findUnique({ where: { id: first.id } }),
    ).resolves.not.toBeNull();
  });
});
