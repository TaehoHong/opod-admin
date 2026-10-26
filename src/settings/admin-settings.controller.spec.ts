import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { AppConfigService } from "../core/config/app-config.service";
import { GenerationSettingsService } from "./generation-settings.service";
import { SettingsAuditRepository } from "./settings-audit.repository";
import { AdminSettingsController } from "./admin-settings.controller";

function controllerWithCapability(capability: {
  ok: boolean;
  message: string;
}) {
  const settings = {
    getSettings: jest.fn().mockResolvedValue({}),
    testPipelineV3Capability: jest.fn().mockResolvedValue(capability),
    updateSettings: jest.fn().mockResolvedValue({}),
  };
  const audit = {
    recordChanges: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AdminSettingsController(
    settings as never,
    audit as never,
    { worker: { jobCostEstimateUsd: 0.2 } } as never,
  );
  return { controller, settings };
}

describe("AdminSettingsController V3 rollout", () => {
  it("rejects V3 activation when the effective planner lacks strict JSON schema", async () => {
    const { controller, settings } = controllerWithCapability({
      ok: false,
      message: "V3 strict JSON schema 미지원 (400)",
    });

    await expect(
      controller.updateGenerationSettings(
        { pipelineV3Enabled: true } as never,
        { admin: { id: "admin-1", email: "admin@example.com" } } as never,
      ),
    ).rejects.toThrow("V3 strict JSON schema 미지원 (400)");
    expect(settings.updateSettings).not.toHaveBeenCalled();
  });
});

describe("scheduled publication settings HTTP contract", () => {
  it("saves and reloads the publication switch independently and rejects invalid input", async () => {
    const rows = new Map<string, string>([["worker.enabled", "false"]]);
    const settings = new GenerationSettingsService({
      findByKeys: async (keys: string[]) =>
        keys
          .filter((key) => rows.has(key))
          .map((key) => ({ key, value: rows.get(key)! })),
      upsertValue: async (key: string, value: string) => {
        rows.set(key, value);
      },
      deleteByKey: async (key: string) => {
        rows.delete(key);
      },
    } as never);
    const module = await Test.createTestingModule({
      controllers: [AdminSettingsController],
      providers: [
        { provide: GenerationSettingsService, useValue: settings },
        {
          provide: SettingsAuditRepository,
          useValue: {
            recordChanges: async () => {},
            sumGenerationCostSince: async () => 0,
          },
        },
        {
          provide: AppConfigService,
          useValue: { worker: { jobCostEstimateUsd: 0.2 } },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    const path = "/api/admin/v1/settings/generation";
    try {
      await request(app.getHttpServer())
        .put(path)
        .send({ scheduledPublishEnabled: false })
        .expect(200);
      const disabled = await request(app.getHttpServer()).get(path).expect(200);
      expect(disabled.body.scheduledPublication).toEqual({
        enabled: false,
        source: "db",
      });
      expect(disabled.body.worker.enabled).toBe(false);
      await request(app.getHttpServer())
        .put(path)
        .send({ scheduledPublishEnabled: "yes" })
        .expect(400);
      expect(
        (await settings.resolveWorkerToggles({})).publication.enabled,
      ).toBe(false);
      await request(app.getHttpServer())
        .put(path)
        .send({ scheduledPublishEnabled: true })
        .expect(200);
      const enabled = await request(app.getHttpServer()).get(path).expect(200);
      expect(enabled.body.scheduledPublication).toEqual({
        enabled: true,
        source: "db",
      });
      expect(enabled.body.worker.enabled).toBe(false);
    } finally {
      await app.close();
    }
  });
});
