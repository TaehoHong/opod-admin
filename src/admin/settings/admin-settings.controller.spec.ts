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
