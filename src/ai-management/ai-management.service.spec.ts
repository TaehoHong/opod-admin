import { ConflictException } from "@nestjs/common";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import {
  AI_MANAGEMENT_KEY,
  AiManagementConfig,
} from "../settings/ai-management";
import { resolveImageGenerationProviders } from "../generation/providers/image-generation.provider";
import { AiManagementService } from "./ai-management.service";

function initial(): AiManagementConfig {
  return {
    version: 1,
    revision: "r1",
    changes: [],
    connections: [
      {
        id: "llm",
        type: "llm",
        provider: "openai-compatible",
        apiUrl: "https://llm.test/v1",
        apiKey: "private-key-1234",
        models: [
          { id: "1", model: "planning" },
          { id: "2", model: "caption" },
        ],
      },
      {
        id: "image",
        type: "image",
        provider: "spicyapi",
        apiUrl: "https://proxy.test/api/v1",
        apiKey: "image-secret-5678",
        models: [{ id: "3", model: "alibaba/qwen-image-3.0-pro/edit" }],
      },
    ],
    bindings: {
      "natural.post_plan": { connectionId: "llm", modelId: "1" },
      "natural.caption": { connectionId: "llm", modelId: "1" },
    },
  };
}
function setup(config: AiManagementConfig | null = initial()) {
  const data = new Map<string, string>(
    config ? [[AI_MANAGEMENT_KEY, JSON.stringify(config)]] : [],
  );
  const repository = {
    findByKeys: jest.fn(async (keys: string[]) =>
      keys
        .filter((k) => data.has(k))
        .map((key) => ({ key, value: data.get(key)! })),
    ),
    compareAndSetValue: jest.fn(
      async (key: string, expected: string | null, value: string) => {
        if ((data.get(key) ?? null) !== expected) return false;
        data.set(key, value);
        return true;
      },
    ),
  };
  const settings = new GenerationSettingsService(repository as never);
  const models = {
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
    create: jest.fn(async (input) => ({ id: "10", ...input })),
  };
  return {
    settings,
    repository,
    data,
    service: new AiManagementService(settings, models as never),
  };
}

describe("AI API registry and independent assignments", () => {
  it("masks all keys in reads and writes, preserving a blank replacement", async () => {
    const { service, settings } = setup();
    const view = await service.get();
    expect(view.connections[0].apiKey).toEqual({ set: true, last4: "1234" });
    const saved = await service.saveConnection(
      "llm",
      {
        type: "llm",
        provider: "openai-compatible",
        apiUrl: "https://new.test/v1/chat/completions",
        apiKey: "",
      },
      view.revision,
      "admin@test",
    );
    expect(saved.connections[0].apiUrl).toBe("https://new.test/v1");
    expect((await settings.getAiManagement())!.connections[0].apiKey).toBe(
      "private-key-1234",
    );
    expect(JSON.stringify([view, saved])).not.toContain("private-key");
    expect(JSON.stringify(saved.changes)).not.toContain("secret");
  });

  it("changes one stage, leaves other stages and captured draft selections intact", async () => {
    const { service, settings } = setup();
    const pinned = await settings.snapshotAiAssignments();
    const saved = await service.assign(
      "natural.caption",
      "llm",
      "2",
      "r1",
      "admin@test",
    );
    expect(
      saved.features.find((f) => f.id === "natural.caption")!.selection?.model,
    ).toBe("caption");
    expect(
      saved.features.find((f) => f.id === "natural.post_plan")!.selection
        ?.model,
    ).toBe("planning");
    expect(
      (await settings.resolveAiPlanner("", pinned!["natural.caption"])).model,
    ).toBe("planning");
    expect((await settings.resolveAiPlanner("natural.caption")).model).toBe(
      "caption",
    );
    expect(JSON.stringify(pinned)).not.toContain("key");
  });

  it("rejects type mismatches, models from another API, and stale writes without changing data", async () => {
    const { service, settings, repository } = setup();
    await expect(
      service.assign("natural.caption", "image", "3", "r1", "admin"),
    ).rejects.toThrow("API 유형");
    await expect(
      service.assign("natural.caption", "llm", "3", "r1", "admin"),
    ).rejects.toThrow("등록된 모델");
    await expect(
      service.assign("natural.caption", "llm", "2", "old", "admin"),
    ).rejects.toBeInstanceOf(ConflictException);
    repository.compareAndSetValue.mockResolvedValueOnce(false);
    await expect(
      service.assign("natural.caption", "llm", "2", "r1", "admin"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await settings.getAiManagement())!.bindings["natural.caption"].modelId,
    ).toBe("1");
  });

  it("blocks removal while in use, then archives without breaking already submitted jobs", async () => {
    const { service, settings } = setup();
    await expect(
      service.removeConnection("llm", "r1", "admin"),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.removeModel("llm", "1", "r1", "admin"),
    ).rejects.toBeInstanceOf(ConflictException);
    const pinned = {
      connectionId: "image",
      modelId: "3",
      provider: "spicyapi" as const,
      model: "alibaba/qwen-image-3.0-pro/edit",
    };
    const removed = await service.removeConnection("image", "r1", "admin");
    expect(removed.connections.some((c) => c.id === "image")).toBe(false);
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        Response.json({ data: { taskId: "job-pinned" } }, { status: 202 }),
      );
    await resolveImageGenerationProviders(
      await settings.resolveAiImage(pinned),
      fetchMock,
    ).t2i.submit({
      idempotencyKey: "test",
      profile: "photoreal_scene_v1",
      prompt: "cafe",
      references: [],
      candidateCount: 1,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://proxy.test/api/v1/jobs/createTask",
    );
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      "Bearer image-secret-5678",
    );
  });

  it("bootstraps a read-only catalog without persisting environment credentials", async () => {
    const { service, data, settings } = setup(null);
    jest.spyOn(settings, "resolvePlannerSettings").mockResolvedValue({
      apiUrl: "https://legacy.test/v1/chat/completions",
      apiKey: "env-private-key",
      model: "old-model",
      sources: { apiUrl: "env", apiKey: "env", model: "env" },
    });
    const view = await service.get();
    expect(view.revision).toBeNull();
    expect(data.size).toBe(0);
    const saved = await service.saveConnection(
      null,
      {
        type: "llm",
        provider: "openai-compatible",
        apiUrl: "https://other.test/v1",
        apiKey: "new-key",
      },
      null,
      "admin",
    );
    expect(saved.connections).toHaveLength(view.connections.length + 1);
    expect(data.get(AI_MANAGEMENT_KEY)).not.toContain("env-private-key");
    await expect(
      service.assign(
        "chat.response",
        "llm-1",
        saved.connections
          .find((c) => c.id === "llm-1")!
          .models.find((m) => m.model === "old-model")!.id,
        saved.revision,
        "admin",
      ),
    ).rejects.toThrow("DB에 저장한 인증 키");
  });

  it("never returns a provider's echoed credential from a failed model probe", async () => {
    const { service, settings } = setup();
    jest.spyOn(settings, "testConnection").mockResolvedValue({
      ok: false,
      message: "invalid key private-key-1234",
    });
    const result = await service.test("llm", { modelId: "1" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-key-1234");
  });
});
