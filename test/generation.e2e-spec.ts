import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { adminHeaders } from "./admin-auth";

const uniqueHandle = (base: string) => `${base}-${randomUUID().slice(0, 8)}`;

describe("generation", () => {
  it("enqueues, starts, and completes an image generation job", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const character = await request(app.getHttpServer())
      .post("/admin/characters")
      .set(adminHeaders)
      .send({
        publicId: uniqueHandle("gen"),
        displayName: "Gen",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post("/admin/generation/jobs")
      .set(adminHeaders)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/generation/jobs/${created.body.id}/start`)
      .set(adminHeaders)
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe("running");
      });

    await request(app.getHttpServer())
      .post(`/admin/generation/jobs/${created.body.id}/complete`)
      .set(adminHeaders)
      .send({
        url: "https://cdn.local/generated.png",
        width: 1024,
        height: 1024,
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe("completed");
        expect(response.body.outputMedia.url).toBe(
          "https://cdn.local/generated.png",
        );
      });

    const logs = await request(app.getHttpServer())
      .get("/admin/character-action-logs")
      .set(adminHeaders)
      .expect(200);

    const actionTypes = logs.body
      .filter(
        (log: { targetId?: string; characterId: string }) =>
          log.targetId === created.body.id &&
          log.characterId === character.body.id,
      )
      .map((log: { actionType: string }) => log.actionType);
    expect(actionTypes).toEqual(
      expect.arrayContaining([
        "GENERATION_JOB_COMPLETED",
        "GENERATION_JOB_STARTED",
        "GENERATION_JOB_ENQUEUED",
      ]),
    );

    await app.close();
  });

  it("rejects unsupported media types", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    await request(app.getHttpServer())
      .post("/admin/generation/jobs")
      .set(adminHeaders)
      .send({
        characterId: "ai-1",
        mediaType: "audio",
        prompt: "song",
      })
      .expect(400);

    await app.close();
  });

  it("completes generation with confirmed S3 media", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const character = await request(app.getHttpServer())
      .post("/admin/characters")
      .set(adminHeaders)
      .send({
        publicId: uniqueHandle("gen-media"),
        displayName: "Gen Media",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post("/admin/generation/jobs")
      .set(adminHeaders)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    const upload = await request(app.getHttpServer())
      .post("/admin/media/uploads")
      .set(adminHeaders)
      .send({
        mediaType: "image",
        contentType: "image/png",
        fileName: "generated.png",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/media/${upload.body.media.id}/confirm-upload`)
      .set(adminHeaders)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/generation/jobs/${job.body.id}/start`)
      .set(adminHeaders)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/generation/jobs/${job.body.id}/complete`)
      .set(adminHeaders)
      .send({ mediaId: upload.body.media.id })
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe("completed");
        expect(response.body.outputMedia.url).toBe(upload.body.media.url);
      });

    await app.close();
  });

  it("runs generation jobs through the admin provider route", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const character = await request(app.getHttpServer())
      .post("/admin/characters")
      .set(adminHeaders)
      .send({
        publicId: uniqueHandle("gen-run"),
        displayName: "Gen Run",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);
    const job = await request(app.getHttpServer())
      .post("/admin/generation/jobs")
      .set(adminHeaders)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/generation/jobs/${job.body.id}/run`)
      .set(adminHeaders)
      .send({ provider: "local" })
      .expect(201)
      .expect({
        id: job.body.id,
        status: "running",
      });

    const logs = await request(app.getHttpServer())
      .get("/admin/character-action-logs")
      .set(adminHeaders)
      .expect(200);

    expect(
      logs.body.map((log: { actionType: string }) => log.actionType),
    ).toEqual(expect.arrayContaining(["GENERATION_JOB_RUN"]));

    await app.close();
  });

  it("retries generation jobs as new queued jobs", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const character = await request(app.getHttpServer())
      .post("/admin/characters")
      .set(adminHeaders)
      .send({
        publicId: uniqueHandle("gen-retry"),
        displayName: "Gen Retry",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);
    const job = await request(app.getHttpServer())
      .post("/admin/generation/jobs")
      .set(adminHeaders)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/generation/jobs/${job.body.id}/retry`)
      .set(adminHeaders)
      .send({ reason: "provider timeout" })
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            characterId: character.body.id,
            mediaType: "image",
            prompt: "portrait",
            status: "queued",
          }),
        );
        expect(response.body.id).not.toBe(job.body.id);
      });

    await app.close();
  });

  it("keeps generation jobs in the admin controller", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    await request(app.getHttpServer())
      .post("/generation/jobs")
      .send({})
      .expect(404);

    await app.close();
  });
});
