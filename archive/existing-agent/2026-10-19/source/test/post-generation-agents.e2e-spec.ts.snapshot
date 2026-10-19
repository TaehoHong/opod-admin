import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PostAgentPromptService } from "../src/post-agent-prompts/post-agent-prompt.service";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { StrictJsonAgentClient } from "../src/shared/ai/strict-json-agent";

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

  it("persists immutable prompt versions, resolves model override, rejects concurrent overwrite and restores", async () => {
    const defaults = (
      await request(app.getHttpServer()).get(base).set(headers).expect(200)
    ).body.items;
    expect(defaults.map((v: { stage: string }) => v.stage)).toEqual([
      "post_plan",
      "image_plan",
      "image_prompt",
      "generation",
      "caption",
    ]);
    for (const stage of [
      "post_plan",
      "image_plan",
      "image_prompt",
      "caption",
    ] as const) {
      expect(await app.get(PostAgentPromptService).execution(stage)).toBeNull();
    }
    const model = (
      await request(app.getHttpServer())
        .post(`${base}/models`)
        .set(headers)
        .send({
          type: "llm",
          provider: "openai-compatible",
          model: "shared-model",
        })
        .expect(201)
    ).body;
    expect(model.id).toMatch(/^[1-9][0-9]*$/);
    const initial = defaults.find(
      (v: { stage: string }) => v.stage === "post_plan",
    );
    expect(initial).toMatchObject({
      id: null,
      revision: 0,
      systemPrompt: null,
    });
    expect(initial).not.toHaveProperty("defaultSystemPrompt");
    const body = {
      expectedRevision: 0,
      aiModelId: model.id,
      model: "overridden-model",
      systemPrompt: "Write a plausible everyday post.",
      outputSchema: initial.outputSchema,
    };
    const first = (
      await request(app.getHttpServer())
        .post(`${base}/post_plan/versions`)
        .set(headers)
        .send(body)
        .expect(201)
    ).body;
    expect(first).toMatchObject({
      revision: 1,
      model: "overridden-model",
      effectiveModel: "overridden-model",
      provider: "openai-compatible",
    });
    const attempts = await Promise.all(
      ["A", "B"].map((systemPrompt) =>
        request(app.getHttpServer())
          .post(`${base}/post_plan/versions`)
          .set(headers)
          .send({ ...body, expectedRevision: 1, systemPrompt, model: null }),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    const history = (
      await request(app.getHttpServer())
        .get(`${base}/post_plan/versions`)
        .set(headers)
        .expect(200)
    ).body.items;
    expect(history).toHaveLength(2);
    expect(history[0].effectiveModel).toBe("shared-model");
    expect(history[1].systemPrompt).toBe(body.systemPrompt);
    const restored = (
      await request(app.getHttpServer())
        .post(`${base}/post_plan/versions/${first.id}/restore`)
        .set(headers)
        .send({ expectedRevision: 2 })
        .expect(201)
    ).body;
    expect(restored).toMatchObject({
      revision: 3,
      systemPrompt: body.systemPrompt,
      aiModelId: model.id,
      effectiveModel: "overridden-model",
    });
    await request(app.getHttpServer())
      .post(`${base}/caption/versions/${first.id}/restore`)
      .set(headers)
      .send({ expectedRevision: 0 })
      .expect(404);
    const current = (
      await request(app.getHttpServer()).get(base).set(headers).expect(200)
    ).body.items;
    expect(
      current.find((v: { stage: string }) => v.stage === "post_plan"),
    ).toMatchObject({ id: restored.id, effectiveModel: "overridden-model" });
    await request(app.getHttpServer())
      .post(`${base}/post_plan/reset`)
      .set(headers)
      .send({ expectedRevision: 3 })
      .expect(404);
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
