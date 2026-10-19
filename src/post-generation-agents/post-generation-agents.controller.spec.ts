import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { AiModelService } from "../ai-models/ai-model.service";
import { PostAgentPromptService } from "../post-agent-prompts/post-agent-prompt.service";
import { GenerationSettingsRepository } from "../settings/generation-settings.repository";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { PostGenerationAgentsController } from "./post-generation-agents.controller";

const base = "/api/admin/v1/post-generation-agents";
describe("reference Agent settings HTTP contract", () => {
  let app: INestApplication;
  let values: Map<string, string>;
  let loseCas: boolean;
  let generationAvailable: boolean;
  beforeEach(async () => {
    values = new Map();
    loseCas = false;
    generationAvailable = true;
    const module = await Test.createTestingModule({
      controllers: [PostGenerationAgentsController],
      providers: [
        GenerationSettingsService,
        {
          provide: GenerationSettingsRepository,
          useValue: {
            findByKeys: async (keys: string[]) =>
              keys.flatMap((key) =>
                values.has(key) ? [{ key, value: values.get(key)! }] : [],
              ),
            compareAndSetValue: async (
              key: string,
              expected: string | null,
              value: string,
            ) => {
              if (loseCas || (values.get(key) ?? null) !== expected)
                return false;
              values.set(key, value);
              return true;
            },
          },
        },
        {
          provide: PostAgentPromptService,
          useValue: {
            save: () => ({ stage: "generation" }),
            restore: () => ({ stage: "generation" }),
            history: () => ({ items: [] }),
            execution: () =>
              generationAvailable
                ? {
                    id: "7",
                    revision: 2,
                    aiModelId: "9",
                    provider: "openai",
                    effectiveModel: "saved-image",
                  }
                : null,
          },
        },
        {
          provide: AiModelService,
          useValue: {
            get: (id: string) => ({
              id,
              type: id === "9" ? "image" : "llm",
              provider: "openai-compatible",
              model: `model-${id}`,
            }),
          },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => app.close());
  it("reads defaults without creating stored settings and saves a reference-specific selection", async () => {
    const initial = await request(app.getHttpServer())
      .get(`${base}/reference/config`)
      .expect(200);
    expect(initial.body).toMatchObject({
      current: { revision: null, selection: { batchSize: 12, maxAttempts: 1 } },
    });
    const selectionStarter =
      initial.body.starters.reference_select.systemPrompt;
    expect(selectionStarter).toContain(
      "너는 캐릭터 SNS 게시물의 참조 이미지를 선택하는 Agent다.",
    );
    expect(selectionStarter).toContain("생성 컷 수 범위: 1~3장");
    expect(selectionStarter).toContain(
      "장소, 포즈, 구도, 의상, 분위기가 반복된다는 이유로 감점하지 않는다.",
    );
    expect(selectionStarter).not.toContain("character_influencers");
    expect(values.size).toBe(0);
    values.set("postAgent.natural-v1", "preserved");
    const saved = await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 3 })
      .expect(201);
    expect(saved.body).toEqual({
      revision: expect.any(String),
      selection: { batchSize: 12, maxAttempts: 3 },
    });
    expect(
      (await request(app.getHttpServer()).get(`${base}/reference/config`)).body
        .current,
    ).toEqual(saved.body);
    expect(values.get("postAgent.natural-v1")).toBe("preserved");
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 2 })
      .expect(409);
    const updated = await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: saved.body.revision, maxAttempts: 2 })
      .expect(201);
    expect(updated.body.selection.maxAttempts).toBe(2);
    expect(updated.body.revision).not.toBe(saved.body.revision);
  });
  it("requires an explicit full saved bundle and preserves it when only search settings change", async () => {
    await expect(
      app.get(GenerationSettingsService).requireReferenceAgentConfig(),
    ).rejects.toThrow("모든 단계");
    const stages = {
      reference_select: { aiModelId: "1", systemPrompt: "Saved selection" },
      image_prompt: { aiModelId: "2", systemPrompt: "Saved image prompt" },
      caption: { aiModelId: "3", systemPrompt: "Saved caption" },
    };
    const saved = await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 1, stages })
      .expect(201);
    expect(saved.body.stages.reference_select).toMatchObject({
      aiModelId: "1",
      model: "model-1",
      systemPrompt: "Saved selection",
      outputSchema: { type: "object" },
    });
    expect(saved.body.generation).toEqual({
      id: "7",
      revision: 2,
      aiModelId: "9",
      provider: "openai",
      effectiveModel: "saved-image",
    });
    await expect(
      app.get(GenerationSettingsService).requireReferenceAgentConfig(),
    ).resolves.toEqual(saved.body);
    const changed = await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: saved.body.revision, maxAttempts: 3 })
      .expect(201);
    expect(changed.body.stages).toEqual(saved.body.stages);
    expect(changed.body.generation).toEqual(saved.body.generation);
    expect(changed.body.selection).toEqual({ batchSize: 12, maxAttempts: 3 });
  });
  it("rejects partial or empty stage prompts without saving", async () => {
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({
        expectedRevision: null,
        maxAttempts: 1,
        stages: { caption: { aiModelId: "1", systemPrompt: "caption" } },
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({
        expectedRevision: null,
        maxAttempts: 1,
        stages: {
          reference_select: { aiModelId: "1", systemPrompt: " " },
          image_prompt: { aiModelId: "2", systemPrompt: "image" },
          caption: { aiModelId: "3", systemPrompt: "caption" },
        },
      })
      .expect(400);
    expect(values.size).toBe(0);
  });
  it("rejects image models for LLM stages and requires a saved shared generation model", async () => {
    const stages = {
      reference_select: { aiModelId: "9", systemPrompt: "select" },
      image_prompt: { aiModelId: "2", systemPrompt: "image" },
      caption: { aiModelId: "3", systemPrompt: "caption" },
    };
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 1, stages })
      .expect(400);
    generationAvailable = false;
    stages.reference_select.aiModelId = "1";
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 1, stages })
      .expect(400);
    expect(values.size).toBe(0);
  });
  it.each([0, 4, 1.5, "2", null])(
    "rejects invalid maxAttempts %p without writing",
    async (maxAttempts) => {
      await request(app.getHttpServer())
        .post(`${base}/reference/config`)
        .send({ expectedRevision: null, maxAttempts })
        .expect(400);
      expect(values.size).toBe(0);
    },
  );
  it("keeps batch size fixed even with an override and rejects missing revision", async () => {
    const saved = await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 1, batchSize: 99 })
      .expect(201);
    expect(saved.body.selection).toEqual({ batchSize: 12, maxAttempts: 1 });
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ maxAttempts: 1 })
      .expect(400);
    expect(values.size).toBe(1);
  });
  it("returns conflict if settings change between read and compare-and-set", async () => {
    loseCas = true;
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .send({ expectedRevision: null, maxAttempts: 2 })
      .expect(409);
    expect(values.size).toBe(0);
  });
  it.each(["post_plan", "image_plan", "image_prompt", "caption"])(
    "keeps archived %s history readable and rejects restore",
    async (stage) => {
      await request(app.getHttpServer())
        .get(`${base}/${stage}/versions`)
        .expect(200, { items: [] });
      await request(app.getHttpServer())
        .post(`${base}/${stage}/versions/1/restore`)
        .send({ expectedRevision: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${base}/${stage}/versions`)
        .send({
          expectedRevision: 0,
          aiModelId: "1",
          model: null,
          systemPrompt: null,
          outputSchema: null,
        })
        .expect(400);
    },
  );
  it("retains shared generation settings writes and restores", async () => {
    await request(app.getHttpServer())
      .post(`${base}/generation/versions`)
      .send({
        expectedRevision: 0,
        aiModelId: "1",
        model: null,
        systemPrompt: null,
        outputSchema: null,
      })
      .expect(201, { stage: "generation" });
    await request(app.getHttpServer())
      .post(`${base}/generation/versions/1/restore`)
      .send({ expectedRevision: 0 })
      .expect(201, { stage: "generation" });
  });
});
