import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { GenerationSettingsService } from "../src/settings/generation-settings.service";
import { GenerationSettingsRepository } from "../src/settings/generation-settings.repository";
import { AI_MANAGEMENT_KEY } from "../src/settings/ai-management";
import { adminHeaders } from "./admin-auth";

describe("Admin API/model management persistence", () => {
  let app: INestApplication;
  let headers: Awaited<ReturnType<typeof adminHeaders>>;
  let originalRegistry: string | undefined;
  const path = "/api/admin/v1/ai-management";
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    const [original] = await app
      .get(GenerationSettingsRepository)
      .findByKeys([AI_MANAGEMENT_KEY]);
    originalRegistry = original?.value;
    headers = await adminHeaders(app);
  });
  afterAll(async () => {
    // Restore this suite's fixture in the disposable DB so other suites retain their legacy path.
    if (app) {
      const fixtures = app.get(GenerationSettingsRepository);
      if (originalRegistry === undefined)
        await fixtures.deleteByKey(AI_MANAGEMENT_KEY);
      else await fixtures.upsertValue(AI_MANAGEMENT_KEY, originalRegistry);
    }
    await app?.close();
  });

  it("requires admin authentication and CSRF headers on writes", async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .post(`${path}/connections`)
      .set("cookie", headers.cookie)
      .send({ expectedRevision: null })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${path}/connections`)
      .set(headers)
      .send({
        type: "bad",
        provider: "openai-compatible",
        apiUrl: "https://api.test",
        expectedRevision: null,
      })
      .expect(400);
  });

  it("persists a masked connection, registers models and changes exactly one feature with CAS", async () => {
    let view = (
      await request(app.getHttpServer()).get(path).set(headers).expect(200)
    ).body;
    const created = await request(app.getHttpServer())
      .post(`${path}/connections`)
      .set(headers)
      .send({
        expectedRevision: view.revision,
        type: "llm",
        provider: "openai-compatible",
        apiUrl: "https://assignment.test/v1",
        apiKey: "e2e-private-secret-4321",
      })
      .expect(201);
    view = created.body;
    const connection = view.connections.find(
      (c: { apiUrl: string }) => c.apiUrl === "https://assignment.test/v1",
    );
    expect(connection.apiKey).toEqual({ set: true, last4: "4321" });
    expect(JSON.stringify(view)).not.toContain("e2e-private-secret");
    view = (
      await request(app.getHttpServer())
        .post(`${path}/connections/${connection.id}/models`)
        .set(headers)
        .send({ expectedRevision: view.revision, model: "test-caption" })
        .expect(201)
    ).body;
    const model = view.connections.find(
      (c: { id: string }) => c.id === connection.id,
    ).models[0];
    const before = structuredClone(view.features);
    const revision = view.revision;
    view = (
      await request(app.getHttpServer())
        .put(`${path}/features/natural.caption`)
        .set(headers)
        .send({
          expectedRevision: revision,
          connectionId: connection.id,
          modelId: model.id,
        })
        .expect(200)
    ).body;
    expect(
      view.features.filter((f: { id: string }) => f.id !== "natural.caption"),
    ).toEqual(before.filter((f: { id: string }) => f.id !== "natural.caption"));
    expect(
      view.features.find((f: { id: string }) => f.id === "natural.caption")
        .selection.model,
    ).toBe("test-caption");
    const saved = (
      await request(app.getHttpServer()).get(path).set(headers).expect(200)
    ).body;
    expect(saved).toEqual(view);
    const runtime = await app
      .get(GenerationSettingsService)
      .resolveAiPlanner("natural.caption");
    expect(runtime).toEqual({
      apiUrl: "https://assignment.test/v1/chat/completions",
      apiKey: "e2e-private-secret-4321",
      model: "test-caption",
    });
    await request(app.getHttpServer())
      .put(`${path}/features/natural.caption`)
      .set(headers)
      .send({
        expectedRevision: revision,
        connectionId: connection.id,
        modelId: model.id,
      })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`${path}/connections/${connection.id}`)
      .set(headers)
      .send({ expectedRevision: saved.revision })
      .expect(409);
    const noHeader = { ...headers };
    delete (noHeader as Record<string, string>)[ADMIN_REQUEST_HEADER];
    await request(app.getHttpServer())
      .delete(`${path}/connections/${connection.id}`)
      .set(noHeader)
      .send({ expectedRevision: saved.revision })
      .expect(403);
  });
});
