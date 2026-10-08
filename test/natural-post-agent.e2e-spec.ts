import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/core/database/database.service";
import {
  adminSettings,
  aiModels,
  postAgentPrompts,
  generationJobs,
  postDrafts,
} from "../src/core/database/schema";
import { PostAgentPromptService } from "../src/post-agent-prompts/post-agent-prompt.service";
import { GenerationSettingsService } from "../src/settings/generation-settings.service";
import { DraftWorkerRepository } from "../src/drafts/draft-worker.repository";
import { adminHeaders } from "./admin-auth";

const base = "/api/admin/v1/post-generation-agents";
describe("natural post agent durable settings and recovery", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
  let characterId: string;
  let llmId: string;
  let starters: Record<string, string>;
  let originalNaturalValue: string | undefined;
  let generationVersionId: string;
  let imageId: string;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    headers = await adminHeaders(app);
    const [original] = await app
      .get(DatabaseService)
      .client.select()
      .from(adminSettings)
      .where(eq(adminSettings.key, "postAgent.natural-v1"));
    originalNaturalValue = original?.value;
    characterId = (
      await request(app.getHttpServer())
        .post("/api/admin/v1/characters")
        .set(headers)
        .send({
          publicId: `natural-${randomUUID().slice(0, 8)}`,
          displayName: "Photo Test",
          bio: "A fictional character",
          interests: ["photos"],
        })
        .expect(201)
    ).body.id;
    llmId = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "llm",
          provider: "openai-compatible",
          model: "vision-test",
        })
        .expect(201)
    ).body.id;
    imageId = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "image",
          provider: "openai",
          model: "gpt-image-2.5-sunburst",
        })
        .expect(201)
    ).body.id;
    const current = (
      await request(app.getHttpServer()).get(base).set(headers).expect(200)
    ).body.items.find((item: { stage: string }) => item.stage === "generation");
    generationVersionId = (
      await request(app.getHttpServer())
        .post(`${base}/generation/versions`)
        .set(headers)
        .send({
          expectedRevision: current.revision,
          aiModelId: imageId,
          model: null,
          systemPrompt: null,
          outputSchema: null,
        })
        .expect(201)
    ).body.id;
    starters = (
      await request(app.getHttpServer())
        .get(`${base}/natural/config`)
        .set(headers)
        .expect(200)
    ).body.starters;
  });
  beforeEach(async () => {
    await app
      .get(DatabaseService)
      .client.delete(adminSettings)
      .where(eq(adminSettings.key, "postAgent.natural-v1"));
  });
  afterAll(async () => {
    if (!app) return;
    try {
      const db = app.get(DatabaseService).client;
      await db
        .delete(postAgentPrompts)
        .where(eq(postAgentPrompts.id, BigInt(generationVersionId)));
      await db
        .delete(aiModels)
        .where(inArray(aiModels.id, [BigInt(llmId), BigInt(imageId)]));
      await db
        .delete(adminSettings)
        .where(eq(adminSettings.key, "postAgent.natural-v1"));
      if (originalNaturalValue !== undefined)
        await db
          .insert(adminSettings)
          .values({ key: "postAgent.natural-v1", value: originalNaturalValue });
    } finally {
      await app.close();
    }
  });

  it("identifies the missing saved image version and wrong LLM fields separately", async () => {
    const body = {
      expectedRevision: null,
      schedulerDefault: false,
      planningAiModelId: llmId,
      reviewAiModelId: llmId,
      prompts: starters,
    };
    const execution = jest
      .spyOn(app.get(PostAgentPromptService), "execution")
      .mockResolvedValueOnce(null);
    try {
      const missing = await request(app.getHttpServer())
        .post(`${base}/natural/config`)
        .set(headers)
        .send(body)
        .expect(400);
      expect(missing.body.message).toBe("이미지 생성 모델을 먼저 저장하세요.");
    } finally {
      execution.mockRestore();
    }
    const planning = await request(app.getHttpServer())
      .post(`${base}/natural/config`)
      .set(headers)
      .send({ ...body, planningAiModelId: imageId })
      .expect(400);
    expect(planning.body.message).toBe("기획·캡션 모델은 LLM을 선택하세요.");
    const review = await request(app.getHttpServer())
      .post(`${base}/natural/config`)
      .set(headers)
      .send({ ...body, reviewAiModelId: imageId })
      .expect(400);
    expect(review.body.message).toBe("사진 검수 모델은 LLM을 선택하세요.");
    expect(
      await app.get(GenerationSettingsService).getNaturalAgentBundle(),
    ).toBeNull();
  });

  it("requires saved configuration, rejects competing settings writes and freezes selected draft settings", async () => {
    await request(app.getHttpServer())
      .post("/api/admin/v1/drafts")
      .set(headers)
      .send({ characterId, postGenerationAgent: "natural-v1" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/admin/v1/drafts")
      .set(headers)
      .send({ characterId, postGenerationAgent: "invalid" })
      .expect(400);
    const legacy = (
      await request(app.getHttpServer()).get(base).set(headers).expect(200)
    ).body;
    const body = {
      expectedRevision: null,
      schedulerDefault: false,
      planningAiModelId: llmId,
      reviewAiModelId: llmId,
      prompts: starters,
    };
    const attempts = await Promise.all(
      ["one", "two"].map((name) =>
        request(app.getHttpServer())
          .post(`${base}/natural/config`)
          .set(headers)
          .send({
            ...body,
            prompts: {
              ...starters,
              post_plan: `${starters.post_plan}\n${name}`,
            },
          }),
      ),
    );
    expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
    const selected = attempts.find((result) => result.status === 201)!.body;
    const created = (
      await request(app.getHttpServer())
        .post("/api/admin/v1/drafts")
        .set(headers)
        .send({
          characterId,
          postGenerationAgent: "natural-v1",
          sceneHint: "drying a cup",
        })
        .expect(201)
    ).body;
    expect(created.conceptJson).toMatchObject({
      postGenerationAgent: "natural-v1",
      mode: "auto",
      naturalAgentConfig: { revision: selected.revision },
      pipelineVersion: "post-pipeline-v4",
    });
    const changed = (
      await request(app.getHttpServer())
        .post(`${base}/natural/config`)
        .set(headers)
        .send({
          ...body,
          expectedRevision: selected.revision,
          schedulerDefault: true,
          prompts: {
            ...starters,
            image_plan: `${starters.image_plan}\nNew settings`,
          },
        })
        .expect(201)
    ).body;
    expect(changed.revision).not.toBe(selected.revision);
    const reread = (
      await request(app.getHttpServer())
        .get(`/api/admin/v1/drafts/${created.id}`)
        .set(headers)
        .expect(200)
    ).body;
    expect(reread.conceptJson.naturalAgentConfig).toEqual(selected);
    expect(
      (await request(app.getHttpServer()).get(base).set(headers).expect(200))
        .body,
    ).toEqual(legacy);
    expect(
      await app.get(GenerationSettingsService).scheduledAgentConcept(),
    ).toMatchObject({
      mode: "auto",
      postGenerationAgent: "natural-v1",
      naturalAgentConfig: { revision: changed.revision },
    });
  });

  it("allows safe hold and resume, and regenerates specifically rejected photos before fresh caption review", async () => {
    await request(app.getHttpServer())
      .post(`${base}/natural/config`)
      .set(headers)
      .send({
        expectedRevision: null,
        schedulerDefault: false,
        planningAiModelId: llmId,
        reviewAiModelId: llmId,
        prompts: starters,
      })
      .expect(201);
    const created = (
      await request(app.getHttpServer())
        .post("/api/admin/v1/drafts")
        .set(headers)
        .send({ characterId, postGenerationAgent: "natural-v1" })
        .expect(201)
    ).body;
    const held = (
      await request(app.getHttpServer())
        .post(`/api/admin/v1/drafts/${created.id}/automation`)
        .set(headers)
        .send({ enabled: false })
        .expect(201)
    ).body;
    expect(held.conceptJson.mode).toBe("manual");
    const resumed = (
      await request(app.getHttpServer())
        .post(`/api/admin/v1/drafts/${created.id}/automation`)
        .set(headers)
        .send({ enabled: true })
        .expect(201)
    ).body;
    expect(resumed.conceptJson.mode).toBe("auto");
    const db = app.get(DatabaseService).client;
    const rejected = {
      ...resumed.conceptJson,
      pipeline: {
        stage: "caption",
        state: "needs_input",
        failure: { code: "photo_quality_rejected" },
      },
      photoReview: { status: "rejected" },
    };
    await db
      .update(postDrafts)
      .set({
        conceptJson: rejected,
        status: "planned",
        leaseExpiresAt: new Date(Date.now() + 60000),
      })
      .where(eq(postDrafts.id, created.id));
    await request(app.getHttpServer())
      .post(`/api/admin/v1/drafts/${created.id}/automation`)
      .set(headers)
      .send({ enabled: false })
      .expect(400);
    const [source] = await db
      .insert(generationJobs)
      .values({
        characterId,
        draftId: created.id,
        sortOrder: 0,
        mediaType: "image",
        prompt: "photograph",
        inputPrompt: "photograph",
        status: "completed",
        candidateCount: 1,
      })
      .returning();
    await request(app.getHttpServer())
      .post(`/api/admin/v1/drafts/${created.id}/jobs/${source.id}/regenerate`)
      .set(headers)
      .send({ runNow: false })
      .expect(400);
    await db
      .update(postDrafts)
      .set({ leaseExpiresAt: null })
      .where(eq(postDrafts.id, created.id));
    const regenerated = (
      await request(app.getHttpServer())
        .post(`/api/admin/v1/drafts/${created.id}/jobs/${source.id}/regenerate`)
        .set(headers)
        .send({ runNow: false })
        .expect(201)
    ).body;
    expect(regenerated.status).toBe("regenerating");
    expect(regenerated.shots[0].jobId).not.toBe(source.id);
    const repo = app.get(DraftWorkerRepository);
    expect(
      await repo.markDraftCaptionPending(created.id, "regenerating", {
        ...rejected,
        pipeline: { stage: "caption", state: "pending" },
      }),
    ).toBe(true);
    expect(await repo.claimV3DraftNow(created.id, 120)).toBe(true);
    const claimed = (
      await request(app.getHttpServer())
        .get(`/api/admin/v1/drafts/${created.id}`)
        .set(headers)
        .expect(200)
    ).body;
    expect(claimed.conceptJson).toMatchObject({
      postGenerationAgent: "natural-v1",
      photoReview: { status: "rejected" },
      pipeline: { stage: "caption", state: "running" },
    });
  });
});
