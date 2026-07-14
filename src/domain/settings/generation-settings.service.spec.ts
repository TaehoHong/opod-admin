import { GenerationSettingsService } from "./generation-settings.service";

type PrismaMock = {
  adminSetting: {
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
};

function prismaMock(rows: { key: string; value: string }[] = []): PrismaMock {
  return {
    adminSetting: {
      findMany: jest.fn().mockResolvedValue(rows),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function makeService(prisma: PrismaMock) {
  return new GenerationSettingsService(prisma as never);
}

describe("GenerationSettingsService", () => {
  it("maps stored rows to named fields", async () => {
    const prisma = prismaMock([
      { key: "generation.falApiKey", value: "fal-secret-1234" },
      { key: "generation.falImageModel", value: "fal-ai/nano-banana/edit" },
    ]);

    await expect(makeService(prisma).getSettings()).resolves.toEqual({
      falApiKey: "fal-secret-1234",
      falImageModel: "fal-ai/nano-banana/edit",
    });
  });

  it("upserts values, deletes null/blank fields, and keeps missing fields", async () => {
    const prisma = prismaMock();
    const service = makeService(prisma);

    await service.updateSettings({
      falApiKey: " fal-secret-5678 ",
      falImageModel: null,
      // falImageT2iModel 누락 = 유지
    });

    expect(prisma.adminSetting.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.adminSetting.upsert).toHaveBeenCalledWith({
      where: { key: "generation.falApiKey" },
      create: { key: "generation.falApiKey", value: "fal-secret-5678" },
      update: { value: "fal-secret-5678" },
    });
    expect(prisma.adminSetting.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.adminSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: "generation.falImageModel" },
    });
  });

  it("treats an empty string update as a delete", async () => {
    const prisma = prismaMock();

    await makeService(prisma).updateSettings({ falImageT2iModel: "  " });

    expect(prisma.adminSetting.upsert).not.toHaveBeenCalled();
    expect(prisma.adminSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: "generation.falImageT2iModel" },
    });
  });

  it("prefers DB values over env and reports sources", async () => {
    const prisma = prismaMock([
      { key: "generation.falApiKey", value: "db-key" },
    ]);

    const resolved = await makeService(prisma).resolveProviderSettings({
      FAL_API_KEY: "env-key",
      FAL_IMAGE_MODEL: "fal-ai/nano-banana/edit",
    });

    expect(resolved).toEqual({
      apiKey: "db-key",
      editModel: "fal-ai/nano-banana/edit",
      t2iModel: undefined,
      sources: { apiKey: "db", editModel: "env", t2iModel: "none" },
    });
  });

  it("resolves the provider names the worker would route to", async () => {
    const prisma = prismaMock([
      { key: "generation.falApiKey", value: "db-key" },
      { key: "generation.falImageModel", value: "fal-ai/nano-banana/edit" },
    ]);

    await expect(makeService(prisma).resolveProviderNames({})).resolves.toEqual(
      {
        // t2i 모델 미설정 → edit 모델 공용
        t2i: "fal:fal-ai/nano-banana/edit",
        edit: "fal:fal-ai/nano-banana/edit",
      },
    );
  });

  it("falls back to the local provider without any key", async () => {
    const prisma = prismaMock();

    await expect(makeService(prisma).resolveProviderNames({})).resolves.toEqual(
      { t2i: "local", edit: "local" },
    );
  });
});
