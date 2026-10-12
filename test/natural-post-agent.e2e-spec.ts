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
import { LocationsService } from "../src/locations/locations.service";
import { adminHeaders } from "./admin-auth";

const base = "/api/admin/v1/post-generation-agents";
describe("natural post agent durable settings and recovery", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
  let characterId: string;
  let llmId: string;
  let starters: Record<string, string>;
  let originalNaturalValue: string | undefined;
  let originalPipelineValue: string | undefined;
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
    const [pipeline] = await app
      .get(DatabaseService)
      .client.select()
      .from(adminSettings)
      .where(eq(adminSettings.key, "pipeline.v3Enabled"));
    originalPipelineValue = pipeline?.value;
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
    const db = app.get(DatabaseService).client;
    await db
      .delete(generationJobs)
      .where(eq(generationJobs.characterId, characterId));
    await db.delete(postDrafts).where(eq(postDrafts.characterId, characterId));
    await db
      .insert(adminSettings)
      .values({ key: "pipeline.v3Enabled", value: "true" })
      .onConflictDoUpdate({
        target: adminSettings.key,
        set: { value: "true" },
      });
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
      await db
        .delete(adminSettings)
        .where(eq(adminSettings.key, "pipeline.v3Enabled"));
      if (originalPipelineValue !== undefined)
        await db
          .insert(adminSettings)
          .values({ key: "pipeline.v3Enabled", value: originalPipelineValue });
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

  it.each([
    ["existing", "manual"],
    ["existing", "auto"],
    ["natural-v1", "manual"],
    ["natural-v1", "auto"],
  ])(
    "persists %s with the requested %s mode through the creation API",
    async (agent, mode) => {
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
          .send({
            characterId,
            postGenerationAgent: agent,
            mode,
          })
          .expect(201)
      ).body;
      expect(created.conceptJson).toMatchObject({
        postGenerationAgent: agent,
        mode,
        pipelineVersion: "post-pipeline-v4",
      });
      await request(app.getHttpServer())
        .post("/api/admin/v1/drafts")
        .set(headers)
        .send({
          characterId,
          postGenerationAgent: agent,
          mode: "invalid",
        })
        .expect(400);
    },
  );

  it.each(["existing", "natural-v1"])(
    "switches %s between manual and auto without bypassing a running or blocked stage",
    async (agent) => {
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
          .send({
            characterId,
            postGenerationAgent: agent,
            mode: "manual",
          })
          .expect(201)
      ).body;
      const repo = app.get(DraftWorkerRepository);
      expect(await repo.claimV3Draft(120)).toBeUndefined();
      const resumed = (
        await request(app.getHttpServer())
          .post(`/api/admin/v1/drafts/${created.id}/automation`)
          .set(headers)
          .send({ enabled: true })
          .expect(201)
      ).body;
      expect(resumed.conceptJson.mode).toBe("auto");
      expect(await repo.claimV3Draft(120)).toBe(created.id);
      await request(app.getHttpServer())
        .post(`/api/admin/v1/drafts/${created.id}/automation`)
        .set(headers)
        .send({ enabled: false })
        .expect(400);
      const db = app.get(DatabaseService).client;
      await db
        .update(postDrafts)
        .set({
          status: "planned",
          leaseExpiresAt: null,
          conceptJson: resumed.conceptJson,
        })
        .where(eq(postDrafts.id, created.id));
      const held = (
        await request(app.getHttpServer())
          .post(`/api/admin/v1/drafts/${created.id}/automation`)
          .set(headers)
          .send({ enabled: false })
          .expect(201)
      ).body;
      expect(held.conceptJson.mode).toBe("manual");
      expect(await repo.claimV3Draft(120)).toBeUndefined();
      await db
        .update(postDrafts)
        .set({
          conceptJson: {
            ...held.conceptJson,
            pipeline: { stage: "caption", state: "needs_input" },
          },
        })
        .where(eq(postDrafts.id, created.id));
      await request(app.getHttpServer())
        .post(`/api/admin/v1/drafts/${created.id}/automation`)
        .set(headers)
        .send({ enabled: true })
        .expect(400);
      const blocked = (
        await request(app.getHttpServer())
          .get(`/api/admin/v1/drafts/${created.id}`)
          .set(headers)
          .expect(200)
      ).body;
      expect(blocked.conceptJson.mode).toBe("manual");
      expect(blocked.conceptJson.pipeline.state).toBe("needs_input");
    },
  );

  it.each([
    ["existing", "post_plan"],
    ["natural-v1", "post_plan"],
    ["existing", "image_plan"],
    ["natural-v1", "image_plan"],
    ["existing", "image_prompt"],
    ["natural-v1", "image_prompt"],
    ["existing", "caption"],
    ["natural-v1", "caption"],
  ])(
    "waits for explicit execution of %s at %s while automatic polling is available",
    async (agent, stage) => {
      const db = app.get(DatabaseService).client;
      const [draft] = await db
        .insert(postDrafts)
        .values({
          characterId,
          draftType: "post",
          contentType: "feed",
          status: "planned",
          conceptJson: {
            pipelineVersion: "post-pipeline-v4",
            postGenerationAgent: agent,
            mode: "manual",
            pipeline: { stage, state: "pending" },
          },
        })
        .returning();
      const repo = app.get(DraftWorkerRepository);
      expect(await repo.claimV3Draft(120)).toBeUndefined();
      const waiting = (
        await request(app.getHttpServer())
          .get(`/api/admin/v1/drafts/${draft.id}`)
          .set(headers)
          .expect(200)
      ).body;
      expect(waiting.status).toBe("planned");
      expect(waiting.conceptJson.pipeline).toEqual({ stage, state: "pending" });
      expect(await repo.claimV3DraftNow(draft.id, 120)).toBe(true);
      const running = (
        await request(app.getHttpServer())
          .get(`/api/admin/v1/drafts/${draft.id}`)
          .set(headers)
          .expect(200)
      ).body;
      expect(running.conceptJson).toMatchObject({
        mode: "manual",
        pipeline: { stage, state: "running" },
      });
    },
  );

  it.each(["existing", "natural-v1"])(
    "keeps %s manual generation and publishing out of automatic worker claims",
    async (agent) => {
      const db = app.get(DatabaseService).client;
      const [draft] = await db
        .insert(postDrafts)
        .values({
          characterId,
          draftType: "post",
          contentType: "feed",
          status: "generating",
          conceptJson: {
            pipelineVersion: "post-pipeline-v4",
            postGenerationAgent: agent,
            mode: "manual",
            pipeline: { stage: "generation", state: "pending" },
          },
        })
        .returning();
      const repo = app.get(DraftWorkerRepository);
      expect(await repo.findGeneratingDrafts(10)).toEqual([]);
      await db
        .update(postDrafts)
        .set({
          status: "planned",
          conceptJson: {
            ...(draft.conceptJson as object),
            pipeline: { stage: "publish", state: "pending" },
          },
        })
        .where(eq(postDrafts.id, draft.id));
      expect(await repo.findDueDrafts(new Date(), 10, 120, new Date())).toEqual(
        [],
      );
      expect(await repo.findApprovedDraft(draft.id, 120)).toMatchObject({
        id: draft.id,
        conceptJson: { mode: "manual" },
      });
    },
  );

  it.each(["existing", "natural-v1"])(
    "queues %s prepared manual images when switching to automatic generation",
    async (agent) => {
      const db = app.get(DatabaseService).client;
      const [draft] = await db
        .insert(postDrafts)
        .values({
          characterId,
          draftType: "post",
          contentType: "feed",
          status: "generating",
          conceptJson: {
            pipelineVersion: "post-pipeline-v4",
            postGenerationAgent: agent,
            mode: "manual",
            pipeline: { stage: "generation", state: "pending" },
          },
        })
        .returning();
      const [job] = await db
        .insert(generationJobs)
        .values({
          characterId,
          draftId: draft.id,
          mediaType: "image",
          sortOrder: 0,
          status: "draft",
          prompt: "Prepared photograph",
        })
        .returning();
      const resumed = (
        await request(app.getHttpServer())
          .post(`/api/admin/v1/drafts/${draft.id}/automation`)
          .set(headers)
          .send({ enabled: true })
          .expect(201)
      ).body;
      expect(resumed.conceptJson.mode).toBe("auto");
      expect(resumed.shots).toMatchObject([
        { jobId: job.id, status: "queued", prompt: "Prepared photograph" },
      ]);
    },
  );

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

  it.each(["structured-v1", "structured-v2", "structured-v3"])(
    "saves %s explicitly and keeps older draft snapshots readable",
    async (planningContract) => {
      await request(app.getHttpServer())
        .post(`${base}/natural/config`)
        .set(headers)
        .send({
          expectedRevision: null,
          planningContract: "structured-v1",
          schedulerDefault: false,
          planningAiModelId: llmId,
          reviewAiModelId: llmId,
          prompts: starters,
        })
        .expect(201);
      const config = (
        await request(app.getHttpServer())
          .get(`${base}/natural/config`)
          .set(headers)
          .expect(200)
      ).body;
      const oldDraft = (
        await request(app.getHttpServer())
          .post("/api/admin/v1/drafts")
          .set(headers)
          .send({ characterId, postGenerationAgent: "natural-v1" })
          .expect(201)
      ).body;
      const saved = (
        await request(app.getHttpServer())
          .post(`${base}/natural/config`)
          .set(headers)
          .send({
            expectedRevision: config.current.revision,
            schedulerDefault: false,
            planningAiModelId: llmId,
            reviewAiModelId: llmId,
            planningContract,
            prompts: {
              ...config.current.prompts,
              ...config.structuredPlanningPrompts,
            },
          })
          .expect(201)
      ).body;
      expect(saved.planningContract).toBe(planningContract);
      const productionSchema =
        saved.schemas.post_plan.properties.result.anyOf[0].properties
          .production;
      expect(productionSchema.required).toContain(
        planningContract === "structured-v3"
          ? "contextFactIds"
          : "contextFacts",
      );
      expect(productionSchema.properties).not.toHaveProperty(
        planningContract === "structured-v3"
          ? "contextFacts"
          : "contextFactIds",
      );
      const created = (
        await request(app.getHttpServer())
          .post("/api/admin/v1/drafts")
          .set(headers)
          .send({ characterId, postGenerationAgent: "natural-v1" })
          .expect(201)
      ).body;
      expect(created.conceptJson.naturalAgentConfig).toEqual(saved);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/admin/v1/drafts/${oldDraft.id}`)
            .set(headers)
            .expect(200)
        ).body.conceptJson.naturalAgentConfig,
      ).toEqual(config.current);
      await request(app.getHttpServer())
        .post(`${base}/natural/config`)
        .set(headers)
        .send({
          expectedRevision: saved.revision,
          schedulerDefault: false,
          planningAiModelId: llmId,
          reviewAiModelId: llmId,
          planningContract: "unsupported",
          prompts: saved.prompts,
        })
        .expect(400);
    },
  );

  it("offers only shared and own non-deleted locations to planning", async () => {
    const other = (
      await request(app.getHttpServer())
        .post("/api/admin/v1/characters")
        .set(headers)
        .send({
          publicId: `other-${randomUUID().slice(0, 8)}`,
          displayName: "Other",
          bio: "Other character",
          interests: [],
        })
        .expect(201)
    ).body;
    const service = app.get(LocationsService);
    const baseLocation = {
      description: "window",
      visualPrompt: "room",
      negativePrompt: "no signage",
    };
    const shared = await service.create({
      ...baseLocation,
      locationKey: `shared-${randomUUID()}`,
      displayName: "Shared",
    });
    const own = await service.create({
      ...baseLocation,
      characterId,
      locationKey: `own-${randomUUID()}`,
      displayName: "Own",
    });
    const foreign = await service.create({
      ...baseLocation,
      characterId: other.id,
      locationKey: `foreign-${randomUUID()}`,
      displayName: "Foreign",
    });
    const removed = await service.create({
      ...baseLocation,
      characterId,
      locationKey: `deleted-${randomUUID()}`,
      displayName: "Deleted",
    });
    await service.delete(removed.id);
    const locations = await service.listForPlanning(characterId);
    expect(locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: own.id, negativePrompt: "no signage" }),
        expect.objectContaining({ id: shared.id }),
      ]),
    );
    expect(locations.map((location) => location.id)).not.toContain(foreign.id);
    expect(locations.map((location) => location.id)).not.toContain(removed.id);
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
