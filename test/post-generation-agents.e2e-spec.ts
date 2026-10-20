import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostAgentPromptService } from "../src/post-agent-prompts/post-agent-prompt.service";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { StrictJsonAgentClient } from "../src/shared/ai/strict-json-agent";
import { ReferenceSelectionAgent } from "../src/post-production/reference-selection-agent";
import { createHash } from "node:crypto";

const base = "/api/admin/v1/post-generation-agents";
describe("post agent management", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
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
  afterAll(async () => {
    await app?.close();
  });

  it("persists ID-only reference selection schema and sends it to the Agent", async () => {
    const llm = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "llm",
          provider: "openai-compatible",
          model: "reference-selector-fixture",
        })
        .expect(201)
    ).body;
    const image = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "image",
          provider: "spicyapi",
          model: "alibaba/qwen-image-3.0-pro/edit",
        })
        .expect(201)
    ).body;
    const before = (
      await request(app.getHttpServer())
        .get(`${base}/reference/config`)
        .set(headers)
        .expect(200)
    ).body;
    await request(app.getHttpServer())
      .post(`${base}/reference/config`)
      .set(headers)
      .send({
        expectedRevision: before.current.revision,
        maxAttempts: 1,
        generationAiModelId: image.id,
        stages: {
          reference_select: {
            aiModelId: llm.id,
            systemPrompt: "Choose source IDs only",
          },
          image_prompt: {
            aiModelId: llm.id,
            systemPrompt: "Build image prompt",
          },
          caption: { aiModelId: llm.id, systemPrompt: "Write caption" },
        },
      })
      .expect(201);
    const view = (
      await request(app.getHttpServer())
        .get(`${base}/reference/config`)
        .set(headers)
        .expect(200)
    ).body;
    const saved = view.current.stages.reference_select;
    expect(saved.outputSchema.properties.selections.items).toEqual({
      type: "object",
      properties: { mediaId: { type: "string" } },
      required: ["mediaId"],
      additionalProperties: false,
    });
    expect(saved.outputSchema).toEqual(
      view.starters.reference_select.outputSchema,
    );
    const decision = {
      status: "selected",
      selections: [{ mediaId: "13" }],
      shortfallReason: "",
    };
    const fetchFn = jest.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(decision) } }],
        }),
      );
    });
    const bytes = Buffer.from("fixture source pixels");
    const client = new StrictJsonAgentClient(
      { apiUrl: "https://example.test", apiKey: "fixture", model: saved.model },
      fetchFn,
      undefined,
      {
        systemPrompt: saved.systemPrompt,
        outputSchema: saved.outputSchema,
        metadata: {},
      },
    );
    const agent = new ReferenceSelectionAgent(client, async () => ({
      bytes,
      contentType: "image/png",
    }));
    const result = await agent.select(
      {
        character: {
          concept: "daily",
          imageStyle: "phone photos",
          constraints: "",
        },
      },
      [
        {
          mediaId: "13",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          media: { url: "https://example.test/source" },
        },
      ],
    );
    expect(result.output).toEqual(decision);
    const sent = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(sent.messages[0].content).toBe("Choose source IDs only");
    expect(sent.response_format.json_schema.schema).toEqual(saved.outputSchema);
  });

  it("keeps saved existing Agent history readable and rejects save and restore", async () => {
    const prompts = app.get(PostAgentPromptService);
    const model = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "llm",
          provider: "openai-compatible",
          model: "historical-model",
        })
        .expect(201)
    ).body;
    const current = await prompts.current("post_plan");
    const saved = await prompts.save("post_plan", {
      expectedRevision: current.revision,
      aiModelId: model.id,
      model: null,
      systemPrompt: "Historical instructions",
      outputSchema: current.outputSchema,
    });
    await request(app.getHttpServer())
      .get(`${base}/post_plan/versions`)
      .set(headers)
      .expect(200)
      .expect((response) =>
        expect(response.body.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: saved.id })]),
        ),
      );
    await request(app.getHttpServer())
      .post(`${base}/post_plan/versions`)
      .set(headers)
      .send({
        expectedRevision: saved.revision,
        aiModelId: model.id,
        model: null,
        systemPrompt: "New instructions",
        outputSchema: current.outputSchema,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/post_plan/versions/${saved.id}/restore`)
      .set(headers)
      .send({ expectedRevision: saved.revision })
      .expect(400);
    expect((await prompts.current("post_plan")).id).toBe(saved.id);
  });

  it("requires authentication, CSRF, a model reference and a compatible output schema/type", async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/models`)
      .set("cookie", headers.cookie)
      .send({ type: "llm", provider: "openai-compatible", model: "x" })
      .expect(403);
    const defaults = (
      await request(app.getHttpServer()).get(base).set(headers).expect(200)
    ).body.items;
    const caption = defaults.find(
      (v: { stage: string }) => v.stage === "caption",
    );
    const image = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "image",
          provider: "openai",
          model: "gpt-image-2.5-sunburst",
        })
        .expect(201)
    ).body;
    const body = {
      expectedRevision: 0,
      aiModelId: image.id,
      model: null,
      systemPrompt: "Caption",
      outputSchema: caption.outputSchema,
    };
    await request(app.getHttpServer())
      .post(`${base}/caption/versions`)
      .set(headers)
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/caption/versions`)
      .set(headers)
      .send({ ...body, aiModelId: null })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/caption/versions`)
      .set(headers)
      .send({ ...body, aiModelId: "9223372036854775808" })
      .expect(400);
    const llm = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "llm",
          provider: "openai-compatible",
          model: "caption-model",
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`${base}/caption/versions`)
      .set(headers)
      .send({ ...body, aiModelId: llm.id, outputSchema: { type: "object" } })
      .expect(400);
    const generation = (
      await request(app.getHttpServer())
        .post(`${base}/generation/versions`)
        .set(headers)
        .send({
          expectedRevision: 0,
          aiModelId: image.id,
          model: null,
          systemPrompt: null,
          outputSchema: null,
        })
        .expect(201)
    ).body;
    expect(generation).toMatchObject({
      provider: "openai",
      effectiveModel: "gpt-image-2.5-sunburst",
    });
    expect(
      await app.get(PostAgentPromptService).execution("generation"),
    ).toMatchObject({ outputSchema: null, systemPrompt: null });
  });

  it.each(["post_plan", "image_plan", "image_prompt", "caption"] as const)(
    "sends %s saved through JSONB with planner status first and leaves stored versions unchanged",
    async (stage) => {
      const prompts = app.get(PostAgentPromptService);
      const current = await prompts.current(stage);
      const model = (
        await request(app.getHttpServer())
          .post(`${base}/models`)
          .set(headers)
          .send({ type: "llm", provider: "openai-compatible", model: stage })
          .expect(201)
      ).body;
      const saved = await prompts.save(stage, {
        expectedRevision: current.revision,
        aiModelId: model.id,
        model: "wire-model",
        systemPrompt: `Saved ${stage} instructions`,
        outputSchema: current.outputSchema,
      });
      const stored = await prompts.getVersion(stage, saved.id);
      const original = JSON.stringify(stored);
      const selected = (await prompts.execution(stage))!;
      expect(selected).toEqual(stored);
      const input = { operatorRequest: "Keep this input exactly." };
      const fetchMock = jest.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: '{"result":{}}' } }],
        }),
      );
      await new StrictJsonAgentClient(
        {
          apiUrl: "https://llm.test/v1/chat/completions",
          apiKey: "test",
          model: selected.effectiveModel!,
        },
        fetchMock,
      ).run({
        logType: "admin.v3.post.plan",
        schemaName: stage,
        schema: selected.outputSchema as Record<string, unknown>,
        systemPrompt: selected.systemPrompt!,
        input,
      });
      const wire = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(wire.model).toBe("wire-model");
      expect(wire.messages).toEqual([
        { role: "system", content: stored.systemPrompt },
        { role: "user", content: JSON.stringify(input) },
      ]);
      const schema = wire.response_format.json_schema.schema;
      expect(schema).toEqual(stored.outputSchema);
      if (stage === "post_plan" || stage === "image_plan") {
        const variants = schema.properties.result.anyOf;
        const storedVariants = (stored.outputSchema as typeof schema).properties
          .result.anyOf;
        expect(Object.keys(storedVariants[0].properties)[0]).toBe(
          stage === "post_plan" ? "intent" : "shots",
        );
        variants.forEach(
          (variant: { properties: Record<string, unknown> }, i: number) => {
            expect(Object.keys(variant.properties)).toEqual([
              "status",
              ...Object.keys(storedVariants[i].properties).filter(
                (key) => key !== "status",
              ),
            ]);
            expect(
              JSON.stringify(
                Object.entries(variant.properties).filter(
                  ([key]) => key !== "status",
                ),
              ),
            ).toBe(
              JSON.stringify(
                Object.entries(storedVariants[i].properties).filter(
                  ([key]) => key !== "status",
                ),
              ),
            );
          },
        );
      } else {
        expect(JSON.stringify(schema)).toBe(
          JSON.stringify(stored.outputSchema),
        );
      }
      expect(JSON.stringify(stored)).toBe(original);
      expect(JSON.stringify(await prompts.current(stage))).toBe(original);
      expect(JSON.stringify(await prompts.getVersion(stage, saved.id))).toBe(
        original,
      );
    },
  );
});
