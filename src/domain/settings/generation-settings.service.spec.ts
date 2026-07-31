import {
  GENERATION_SETTING_KEYS,
  GenerationSettingsService,
  settingsChangeEntries,
} from "./generation-settings.service";

type RepositoryMock = {
  findByKeys: jest.Mock;
  upsertValue: jest.Mock;
  deleteByKey: jest.Mock;
};

function repositoryMock(
  rows: { key: string; value: string }[] = [],
): RepositoryMock {
  return {
    findByKeys: jest.fn().mockResolvedValue(rows),
    upsertValue: jest.fn().mockResolvedValue(undefined),
    deleteByKey: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(repository: RepositoryMock) {
  return new GenerationSettingsService(repository as never);
}

describe("GenerationSettingsService", () => {
  it("maps stored rows to named fields", async () => {
    const repository = repositoryMock([
      { key: "generation.falApiKey", value: "fal-secret-1234" },
      { key: "generation.falImageModel", value: "fal-ai/nano-banana/edit" },
    ]);

    await expect(makeService(repository).getSettings()).resolves.toEqual({
      falApiKey: "fal-secret-1234",
      falImageModel: "fal-ai/nano-banana/edit",
    });
    expect(repository.findByKeys).toHaveBeenCalledWith(
      Object.values(GENERATION_SETTING_KEYS),
    );
  });

  it("upserts values, deletes null/blank fields, and keeps missing fields", async () => {
    const repository = repositoryMock();
    const service = makeService(repository);

    await service.updateSettings({
      falApiKey: " fal-secret-5678 ",
      falImageModel: null,
      // falImageT2iModel 누락 = 유지
    });

    expect(repository.upsertValue).toHaveBeenCalledTimes(1);
    expect(repository.upsertValue).toHaveBeenCalledWith(
      "generation.falApiKey",
      "fal-secret-5678",
    );
    expect(repository.deleteByKey).toHaveBeenCalledTimes(1);
    expect(repository.deleteByKey).toHaveBeenCalledWith(
      "generation.falImageModel",
    );
  });

  it("treats an empty string update as a delete", async () => {
    const repository = repositoryMock();

    await makeService(repository).updateSettings({
      falImageT2iModel: "  ",
    });

    expect(repository.upsertValue).not.toHaveBeenCalled();
    expect(repository.deleteByKey).toHaveBeenCalledWith(
      "generation.falImageT2iModel",
    );
  });

  it("prefers DB values over env and reports sources", async () => {
    const repository = repositoryMock([
      { key: "generation.falApiKey", value: "db-key" },
    ]);

    const resolved = await makeService(repository).resolveProviderSettings({
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
    const repository = repositoryMock([
      { key: "generation.falApiKey", value: "db-key" },
      { key: "generation.falImageModel", value: "fal-ai/nano-banana/edit" },
    ]);

    await expect(
      makeService(repository).resolveProviderNames({}),
    ).resolves.toEqual({
      // t2i 모델 미설정 → edit 모델 공용
      t2i: "fal:fal-ai/nano-banana/edit",
      edit: "fal:fal-ai/nano-banana/edit",
      planner: "unconfigured",
    });
  });

  it("resolves the LLM planner when url/key/model are all present", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiKey", value: "sk-db" },
      { key: "planner.llmModel", value: "gpt-5-mini" },
    ]);
    const service = makeService(repository);

    const resolved = await service.resolvePlannerSettings({
      LLM_API_URL: "https://llm.example/v1/chat/completions",
    });
    expect(resolved).toEqual({
      apiUrl: "https://llm.example/v1/chat/completions",
      apiKey: "sk-db",
      model: "gpt-5-mini",
      sources: { apiUrl: "env", apiKey: "db", model: "db" },
    });

    await expect(
      service.resolveProviderNames({
        LLM_API_URL: "https://llm.example/v1/chat/completions",
      }),
    ).resolves.toMatchObject({ planner: "llm:gpt-5-mini" });
  });

  // 이미지 설정이 없으면 생성은 실패하지만 설정 화면은 떠야 한다 —
  // 여기서 예외가 나가면 admin 설정 페이지 전체가 500이 된다.
  it("reports unconfigured image and planner providers without any key", async () => {
    const repository = repositoryMock();

    await expect(
      makeService(repository).resolveProviderNames({}),
    ).resolves.toEqual({
      t2i: null,
      edit: null,
      planner: "unconfigured",
    });
  });

  it("testConnection distinguishes auth failure from success and merges form input over effective settings", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiKey", value: "db-key" },
    ]);
    const service = makeService(repository);
    const fetchMock = jest.fn();

    // fal: 401 = 키 무효, 404(존재하지 않는 요청) = 키 유효.
    fetchMock.mockResolvedValueOnce({ status: 401 });
    await expect(
      service.testConnection(
        { target: "image", falApiKey: "bad" },
        {},
        fetchMock as never,
      ),
    ).resolves.toMatchObject({ ok: false });
    fetchMock.mockResolvedValueOnce({ status: 404 });
    await expect(
      service.testConnection(
        { target: "image", falApiKey: "good" },
        {},
        fetchMock as never,
      ),
    ).resolves.toMatchObject({ ok: true });

    // planner: 실효 설정(DB 키) 위에 폼 입력(URL·모델)을 덮어 호출한다.
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(
      service.testConnection(
        {
          target: "planner",
          llmApiUrl: "https://llm.test/v1/chat",
          llmModel: "m1",
        },
        {},
        fetchMock as never,
      ),
    ).resolves.toMatchObject({ ok: true });
    const call = fetchMock.mock.calls[2];
    expect(call[0]).toBe("https://llm.test/v1/chat");
    expect(call[1].headers.authorization).toBe("Bearer db-key");

    // 셋 중 하나라도 해석 불가면 호출 없이 실패를 돌려준다.
    await expect(
      service.testConnection({ target: "planner" }, {}, fetchMock as never),
    ).resolves.toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("settingsChangeEntries logs only real diffs and masks secrets to last4", () => {
    const entries = settingsChangeEntries(
      { falApiKey: "old-key-abcd", falImageModel: "fal-ai/nano-banana/edit" },
      { falApiKey: "new-key-wxyz", llmModel: "gpt-5-mini" },
      {
        falApiKey: "new-key-wxyz", // 변경 → last4만
        falImageModel: null, // 삭제
        falImageT2iModel: null, // 원래 없던 값 삭제 → diff 없음
        llmModel: "gpt-5-mini", // 신규 → 원문
      },
    );

    expect(entries).toEqual([
      {
        target: "generation.falApiKey",
        actionType: "SETTINGS_SET",
        summary: "····wxyz",
      },
      {
        target: "generation.falImageModel",
        actionType: "SETTINGS_CLEAR",
        summary: "삭제 (env 폴백 복귀)",
      },
      {
        target: "planner.llmModel",
        actionType: "SETTINGS_SET",
        summary: "gpt-5-mini",
      },
    ]);
  });
});
