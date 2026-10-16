import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { GenerationSettingsService } from "../src/settings/generation-settings.service";
import { resolveImageGenerationProviders } from "../src/generation/providers/image-generation.provider";
import { adminHeaders } from "./admin-auth";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";

describe("DB-managed Qwen common negative", () => {
  let app: INestApplication;
  let headers: Awaited<ReturnType<typeof adminHeaders>>;
  let settings: GenerationSettingsService;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    headers = await adminHeaders(app);
    settings = app.get(GenerationSettingsService);
  });
  afterEach(async () => {
    await settings.updateSettings({ qwenImageNegativePrompt: null });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("persists the admin prompt and sends it with per-shot exclusions through the real settings resolver", async () => {
    await request(app.getHttpServer())
      .put("/api/admin/v1/settings/generation")
      .set(headers)
      .send({ qwenImageNegativePrompt: " watermark, waxy skin " })
      .expect(200);
    const saved = await request(app.getHttpServer())
      .get("/api/admin/v1/settings/generation")
      .set(headers)
      .expect(200);
    expect(saved.body.qwenImageNegativePrompt).toBe("watermark, waxy skin");

    const resolved = await settings.resolveImageModelSettings(
      "spicyapi",
      "alibaba/qwen-image-3.0-pro/edit",
    );
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        Response.json({ data: { taskId: "job_test" } }, { status: 202 }),
      );
    await resolveImageGenerationProviders(
      { ...resolved, spicyApiKey: "test-key" },
      fetchFn,
    ).t2i.submit({
      idempotencyKey: "negative-settings-test",
      profile: "photoreal_scene_v1",
      prompt: "A quiet cafe",
      negativePrompt: "overhead view",
      references: [],
      candidateCount: 1,
    });
    expect(
      JSON.parse(fetchFn.mock.calls[0][1].body).input.negative_prompt,
    ).toBe("watermark, waxy skin, overhead view");
    const changes = await request(app.getHttpServer())
      .get("/api/admin/v1/settings/generation/changes")
      .set(headers)
      .expect(200);
    expect(changes.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "generation.qwenImageNegativePrompt",
          actionType: "SETTINGS_SET",
        }),
      ]),
    );
  });

  it("rejects oversized values without replacing the saved prompt", async () => {
    await settings.updateSettings({ qwenImageNegativePrompt: "watermark" });
    await request(app.getHttpServer())
      .put("/api/admin/v1/settings/generation")
      .set(headers)
      .send({ qwenImageNegativePrompt: "x".repeat(2_001) })
      .expect(400);
    expect((await settings.getSettings()).qwenImageNegativePrompt).toBe(
      "watermark",
    );
  });

  it("clears the common prompt without a hard-coded fallback and preserves unrelated settings", async () => {
    const before = await settings.getSettings();
    await settings.updateSettings({ qwenImageNegativePrompt: "watermark" });
    await request(app.getHttpServer())
      .put("/api/admin/v1/settings/generation")
      .set(headers)
      .send({ qwenImageNegativePrompt: " " })
      .expect(200);
    expect(await settings.getSettings()).toEqual(before);
    const resolved = await settings.resolveImageModelSettings(
      "spicyapi",
      "alibaba/qwen-image-3.0-pro/edit",
    );
    expect(resolved.qwenImageNegativePrompt).toBeUndefined();
  });

  it("requires admin authentication to change the prompt", async () => {
    await request(app.getHttpServer())
      .put("/api/admin/v1/settings/generation")
      .set(ADMIN_REQUEST_HEADER, "1")
      .send({ qwenImageNegativePrompt: "watermark" })
      .expect(401);
  });
});
