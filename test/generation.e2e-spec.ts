import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import type { GeneratedMediaStore } from "../src/worker/generated-media-store";
import { GenerationJobRepository } from "../src/worker/generation-job.repository";
import {
  GenerationWorkerService,
  WorkerConfig,
} from "../src/worker/generation-worker.service";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "../src/worker/image-generation.provider";
import { adminHeaders } from "./admin-auth";

const uniqueHandle = (base: string) => `${base}-${randomUUID().slice(0, 8)}`;
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
// 자동 루프는 resolveEnabled(false)로 끈다 — E2E는 수동 실행 경로만 본다.
const disabledWorkerConfig: WorkerConfig = {
  pollIntervalMs: 15_000,
  jobsPerTick: 1,
  leaseSeconds: 600,
  maxAttempts: 3,
  providerPollIntervalMs: 5_000,
  providerTimeoutMs: 5 * 60_000,
  candidateCount: 2,
  jobCostEstimateUsd: 0.2,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 5 * 60_000,
};

describe("generation", () => {
  it("enqueues, starts, and completes an image generation job", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const headers = await adminHeaders(app);

    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: uniqueHandle("gen"),
        displayName: "Gen",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post("/api/admin/v1/generation/jobs")
      .set(headers)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${created.body.id}/start`)
      .set(headers)
      .expect(201)
      .expect((response) => {
        expect(response.body.status).toBe("running");
      });

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${created.body.id}/complete`)
      .set(headers)
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
      .get("/api/admin/v1/character-action-logs")
      .set(headers)
      .expect(200);

    const actionTypes = logs.body.items
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

    const headers = await adminHeaders(app);

    await request(app.getHttpServer())
      .post("/api/admin/v1/generation/jobs")
      .set(headers)
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

    const headers = await adminHeaders(app);

    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: uniqueHandle("gen-media"),
        displayName: "Gen Media",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post("/api/admin/v1/generation/jobs")
      .set(headers)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    const upload = await request(app.getHttpServer())
      .post("/api/admin/v1/media/uploads")
      .set(headers)
      .send({
        mediaType: "image",
        contentType: "image/png",
        fileName: "generated.png",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/media/${upload.body.media.id}/confirm-upload`)
      .set(headers)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${job.body.id}/start`)
      .set(headers)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${job.body.id}/complete`)
      .set(headers)
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

    const headers = await adminHeaders(app);

    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: uniqueHandle("gen-run"),
        displayName: "Gen Run",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);
    const job = await request(app.getHttpServer())
      .post("/api/admin/v1/generation/jobs")
      .set(headers)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${job.body.id}/run`)
      .set(headers)
      .send({ provider: "local" })
      .expect(201)
      .expect({
        id: job.body.id,
        status: "running",
      });

    const logs = await request(app.getHttpServer())
      .get("/api/admin/v1/character-action-logs")
      .set(headers)
      .expect(200);

    expect(
      logs.body.items.map((log: { actionType: string }) => log.actionType),
    ).toEqual(expect.arrayContaining(["GENERATION_JOB_RUN"]));

    await app.close();
  });

  it("retries generation jobs as new queued jobs", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const headers = await adminHeaders(app);

    const character = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: uniqueHandle("gen-retry"),
        displayName: "Gen Retry",
        bio: "visual",
        interests: ["art"],
      })
      .expect(201);
    const job = await request(app.getHttpServer())
      .post("/api/admin/v1/generation/jobs")
      .set(headers)
      .send({
        characterId: character.body.id,
        mediaType: "image",
        prompt: "portrait",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${job.body.id}/fail`)
      .set(headers)
      .send({ errorMessage: "provider timeout" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/v1/generation/jobs/${job.body.id}/retry`)
      .set(headers)
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

  it("runs the image draft workflow through confirmation and regeneration", async () => {
    const generationEnv = {
      S3_BUCKET: process.env.S3_BUCKET,
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
      FAL_API_KEY: process.env.FAL_API_KEY,
      FAL_IMAGE_MODEL: process.env.FAL_IMAGE_MODEL,
      FAL_IMAGE_T2I_MODEL: process.env.FAL_IMAGE_T2I_MODEL,
    };
    let moduleRef: TestingModule | undefined;
    let app: INestApplication | undefined;

    try {
      delete process.env.S3_BUCKET;
      delete process.env.AWS_REGION;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.S3_PUBLIC_BASE_URL;
      delete process.env.FAL_API_KEY;
      delete process.env.FAL_IMAGE_MODEL;
      delete process.env.FAL_IMAGE_T2I_MODEL;

      const providerRequests: ImageGenerationRequest[] = [];
      const provider: ImageGenerationProvider = {
        name: "e2e-fake-provider",
        async submit(input) {
          providerRequests.push(input);
          return { requestId: "e2e-request-1", sentPrompt: input.prompt };
        },
        async poll() {
          return {
            status: "completed",
            images: Array.from({ length: 3 }, (_, index) => ({
              url: `https://provider.local/candidate-${index + 1}.png`,
              contentType: "image/png",
              width: 1024,
              height: 1024,
            })),
          };
        },
      };
      let storedFile = 0;
      const store: GeneratedMediaStore = async () => {
        storedFile += 1;
        return {
          url: `https://cdn.local/generated/candidate-${storedFile}.png`,
          storageKey: `pod/generated/e2e/candidate-${storedFile}.png`,
        };
      };

      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(GenerationWorkerService)
        .useFactory({
          inject: [GenerationJobRepository],
          factory: (jobs: GenerationJobRepository) =>
            new GenerationWorkerService(
              jobs,
              async () => ({ t2i: provider, edit: provider }),
              store,
              async () => false,
              {
                ...disabledWorkerConfig,
                providerPollIntervalMs: 1,
                providerTimeoutMs: 1_000,
              },
              async () => {},
              async (url) => Buffer.from(`downloaded:${url}`),
            ),
        })
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
      const headers = await adminHeaders(app);
      const character = await request(app.getHttpServer())
        .post("/api/admin/v1/characters")
        .set(headers)
        .send({
          publicId: uniqueHandle("gen-draft"),
          displayName: "Generation Draft",
          bio: "visual",
          interests: ["art"],
        })
        .expect(201);

      // 인물이 보이는 이미지 draft는 업로드가 끝난 신원 레퍼런스가 필요하다.
      // 외부 S3 없이 API만으로 confirmed media를 만들기 위해 일반 생성 잡을
      // URL 결과로 완료한 뒤 캐릭터의 비주얼 레퍼런스로 연결한다.
      const referenceJob = await request(app.getHttpServer())
        .post("/api/admin/v1/generation/jobs")
        .set(headers)
        .send({
          characterId: character.body.id,
          mediaType: "image",
          prompt: "identity reference fixture",
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/v1/generation/jobs/${referenceJob.body.id}/start`)
        .set(headers)
        .expect(201);
      const reference = await request(app.getHttpServer())
        .post(`/api/admin/v1/generation/jobs/${referenceJob.body.id}/complete`)
        .set(headers)
        .send({
          url: "https://cdn.local/generation-draft-reference.png",
          width: 1024,
          height: 1024,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(
          `/api/admin/v1/media/${reference.body.outputMediaId}/confirm-upload`,
        )
        .set(headers)
        .expect(201);
      await request(app.getHttpServer())
        .put(
          `/api/admin/v1/characters/${character.body.id}/visual-profile/references`,
        )
        .set(headers)
        .send({ mediaIds: [reference.body.outputMediaId] })
        .expect(200);

      const created = await request(app.getHttpServer())
        .post("/api/admin/v1/generation/image-jobs/draft")
        .set(headers)
        .send({
          characterId: character.body.id,
          inputPrompt: "street portrait",
          candidateCount: 2,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        status: "draft",
        inputPrompt: "street portrait",
        candidateCount: 2,
      });

      const edited = await request(app.getHttpServer())
        .patch(`/api/admin/v1/generation/jobs/${created.body.id}/draft`)
        .set(headers)
        .send({ prompt: "edited final prompt", candidateCount: 3 })
        .expect(200);
      expect(edited.body).toMatchObject({
        status: "draft",
        prompt: "edited final prompt",
        candidateCount: 3,
      });

      await expect(
        moduleRef.get(GenerationWorkerService).runJobNow(created.body.id),
      ).resolves.toEqual({ jobId: null });
      const stillDraft = await request(app.getHttpServer())
        .get(`/api/admin/v1/generation/jobs/${created.body.id}`)
        .set(headers)
        .expect(200);
      expect(stillDraft.body).toMatchObject({ status: "draft" });
      expect(stillDraft.body).not.toHaveProperty("provider");
      expect(stillDraft.body).not.toHaveProperty("costUsd");
      expect(stillDraft.body).not.toHaveProperty("outputs");

      const confirmed = await request(app.getHttpServer())
        .post(`/api/admin/v1/generation/jobs/${created.body.id}/confirm`)
        .set(headers)
        .expect(201);
      expect(confirmed.body.status).toBe("queued");

      const confirmedAgain = await request(app.getHttpServer())
        .post(`/api/admin/v1/generation/jobs/${created.body.id}/confirm`)
        .set(headers)
        .expect(201);
      expect(confirmedAgain.body.status).toBe("queued");

      const confirmationLogs = await request(app.getHttpServer())
        .get("/api/admin/v1/character-action-logs")
        .set(headers)
        .query({ characterId: character.body.id })
        .expect(200);
      expect(
        confirmationLogs.body.items.filter(
          (log: { actionType: string; targetId?: string }) =>
            log.actionType === "GENERATION_DRAFT_CONFIRMED" &&
            log.targetId === created.body.id,
        ),
      ).toHaveLength(1);

      await request(app.getHttpServer())
        .post("/api/admin/v1/generation/worker/run")
        .set(headers)
        .send({ jobId: created.body.id })
        .expect(201)
        .expect({ jobId: created.body.id });

      const deadline = Date.now() + 5_000;
      let completed: Record<string, unknown> | undefined;
      while (Date.now() < deadline) {
        const response = await request(app.getHttpServer())
          .get(`/api/admin/v1/generation/jobs/${created.body.id}`)
          .set(headers)
          .expect(200);
        if (response.body.status === "completed") {
          completed = response.body;
          break;
        }
        if (response.body.status === "failed") {
          throw new Error(
            `Generation job failed: ${response.body.errorMessage ?? "unknown error"}`,
          );
        }
        await wait(20);
      }
      if (!completed) {
        throw new Error("Generation job did not complete before deadline");
      }

      expect(providerRequests).toEqual([
        expect.objectContaining({
          prompt: "edited final prompt",
          candidateCount: 3,
          references: [
            expect.objectContaining({
              role: "identity",
              primary: true,
              url: "https://cdn.local/generation-draft-reference.png",
            }),
          ],
        }),
      ]);
      expect(completed).toMatchObject({
        status: "completed",
        provider: "e2e-fake-provider",
      });
      const outputs = completed.outputs as Array<{
        mediaId: string;
        selected: boolean;
      }>;
      expect(outputs).toHaveLength(3);
      expect(outputs.every((output) => output.selected === false)).toBe(true);
      expect(completed).not.toHaveProperty("outputMediaId");

      await Promise.all([
        request(app.getHttpServer())
          .post(
            `/api/admin/v1/generation/jobs/${created.body.id}/select-output`,
          )
          .set(headers)
          .send({ mediaId: outputs[1].mediaId })
          .expect(201),
        request(app.getHttpServer())
          .post(
            `/api/admin/v1/generation/jobs/${created.body.id}/select-output`,
          )
          .set(headers)
          .send({ mediaId: outputs[1].mediaId })
          .expect(201),
      ]);
      const selected = await request(app.getHttpServer())
        .get(`/api/admin/v1/generation/jobs/${created.body.id}`)
        .set(headers)
        .expect(200);
      expect(
        selected.body.outputs.filter(
          (output: { selected: boolean }) => output.selected,
        ),
      ).toEqual([
        expect.objectContaining({
          mediaId: outputs[1].mediaId,
          selected: true,
        }),
      ]);

      const selectionLogs = await request(app.getHttpServer())
        .get("/api/admin/v1/character-action-logs")
        .set(headers)
        .query({ characterId: character.body.id })
        .expect(200);
      expect(
        selectionLogs.body.items.filter(
          (log: { actionType: string; targetId?: string }) =>
            log.actionType === "GENERATION_OUTPUT_SELECTED" &&
            log.targetId === created.body.id,
        ),
      ).toHaveLength(1);

      const regenerated = await request(app.getHttpServer())
        .post(`/api/admin/v1/generation/jobs/${created.body.id}/regenerate`)
        .set(headers)
        .expect(201);
      expect(regenerated.body).toMatchObject({
        status: "draft",
        originJobId: created.body.id,
      });
    } finally {
      try {
        if (app) {
          await app.close();
        } else if (moduleRef) {
          await moduleRef.close();
        }
      } finally {
        Object.entries(generationEnv).forEach(([key, value]) => {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        });
      }
    }
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
