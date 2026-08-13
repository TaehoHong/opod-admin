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

  // 평가 LLM은 DB 전용이다. env가 되살아나면 운영자가 화면에서 지운 키로
  // 평가가 계속 과금된다.
  it("inherits the planner per field for the evaluator and ignores evaluator env", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiKey", value: "sk-planner" },
      { key: "planner.llmApiUrl", value: "https://planner.example/v1" },
      { key: "planner.llmModel", value: "gpt-5-mini" },
      { key: "evaluator.llmModel", value: "gpt-5" },
    ]);

    await expect(
      makeService(repository).resolveEvaluatorSettings({
        EVALUATOR_LLM_API_KEY: "sk-should-be-ignored",
        EVALUATOR_LLM_MODEL: "ignored-model",
      }),
    ).resolves.toEqual({
      apiUrl: "https://planner.example/v1",
      apiKey: "sk-planner",
      model: "gpt-5",
      overridden: { apiUrl: false, apiKey: false, model: true },
    });
  });

  // 토글을 잘못 읽으면 화면에서 끈 워커가 계속 돌아 이미지·평가 비용이 샌다.
  it("resolves worker toggles from DB first and falls back to env defaults", async () => {
    const repository = repositoryMock([
      { key: "worker.enabled", value: "false" },
    ]);

    await expect(
      makeService(repository).resolveWorkerToggles({
        WORKER_ENABLED: "true",
        EVALUATION_WORKER_ENABLED: "1",
      }),
    ).resolves.toEqual({
      generation: { enabled: false, source: "db" },
      evaluation: { enabled: true, source: "env" },
    });

    // 아무 곳에도 값이 없으면 꺼짐이다 — 새 배포가 스스로 지출하지 않는다.
    await expect(
      makeService(repositoryMock()).resolveWorkerToggles({}),
    ).resolves.toEqual({
      generation: { enabled: false, source: "none" },
      evaluation: { enabled: false, source: "none" },
    });
  });

  it("keeps V3 off by default and resolves its rollout flag from DB before env", async () => {
    const repository = repositoryMock([
      { key: "pipeline.v3Enabled", value: "false" },
    ]);

    await expect(
      makeService(repository).resolvePipelineV3({
        POST_PIPELINE_V3_ENABLED: "true",
      }),
    ).resolves.toEqual({ enabled: false, source: "db" });
    await expect(
      makeService(repositoryMock()).resolvePipelineV3({}),
    ).resolves.toEqual({ enabled: false, source: "none" });
  });

  it("probes strict JSON schema support before V3 activation", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiUrl", value: "https://llm.test/v1/chat" },
      { key: "planner.llmApiKey", value: "db-key" },
      { key: "planner.llmModel", value: "gpt-5-mini" },
    ]);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"result":{"status":"ready","items":["ok"],"score":5,"note":null}}',
            },
          },
        ],
      }),
    });

    await expect(
      makeService(repository).testPipelineV3Capability({}, fetchMock as never),
    ).resolves.toEqual({
      ok: true,
      message: "V3 strict JSON schema 지원 확인 (gpt-5-mini)",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "opod_pipeline_v3_probe",
        strict: true,
        schema: { type: "object", additionalProperties: false },
      },
    });
    // probe가 실제 V3 스키마와 같은 문법(루트 union envelope)을 확인해야 한다 —
    // 사소한 스키마만 보던 이전 probe는 V3가 깨진 상태에서도 통과했다.
    expect(
      body.response_format.json_schema.schema.properties.result.anyOf,
    ).toHaveLength(2);
  });

  it("retries the V3 capability probe with max_completion_tokens when required", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiUrl", value: "https://llm.test/v1/chat" },
      { key: "planner.llmApiKey", value: "db-key" },
      { key: "planner.llmModel", value: "gpt-5-mini" },
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "use max_completion_tokens instead",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '{"result":{"status":"ready","items":["ok"],"score":5,"note":null}}',
              },
            },
          ],
        }),
      });

    await expect(
      makeService(repository).testPipelineV3Capability({}, fetchMock as never),
    ).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty(
      "max_tokens",
      64,
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveProperty(
      "max_completion_tokens",
      64,
    );
  });

  // 종횡비를 아무도 설정하지 않으면 모델이 제 기본값(가로)으로 뽑는다. 코드
  // 기본값이 없으면 피드에 못 쓰는 이미지가 만들어진다.
  it("falls back to format defaults when no ratio is stored", async () => {
    await expect(
      makeService(repositoryMock()).resolveAspectRatios(),
    ).resolves.toEqual({
      feed: { value: "4:5", source: "default" },
      story: { value: "9:16", source: "default" },
      reel: { value: "9:16", source: "default" },
    });
  });

  it("uses a stored ratio and reports it as db-sourced", async () => {
    const repository = repositoryMock([
      { key: "generation.aspectRatioFeed", value: "1:1" },
    ]);

    await expect(
      makeService(repository).resolveAspectRatios(),
    ).resolves.toEqual({
      feed: { value: "1:1", source: "db" },
      story: { value: "9:16", source: "default" },
      reel: { value: "9:16", source: "default" },
    });
  });

  // 형식이 깨진 값을 그대로 보내면 프로바이더가 422로 거절해 생성 전체가 죽는다.
  // 잘못된 설정 하나가 파이프라인을 멈추는 것보다 기본값으로 계속 도는 편이 낫다.
  it.each(["16x9", "가로세로", "4:", "999:1000"])(
    "ignores the malformed stored ratio %s",
    async (value) => {
      const repository = repositoryMock([
        { key: "generation.aspectRatioFeed", value },
      ]);

      await expect(
        makeService(repository).resolveAspectRatios(),
      ).resolves.toMatchObject({
        feed: { value: "4:5", source: "default" },
      });
    },
  );

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

  it("testConnection retries with max_completion_tokens when the model rejects max_tokens", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiUrl", value: "https://llm.test/v1/chat" },
      { key: "planner.llmApiKey", value: "db-key" },
      { key: "planner.llmModel", value: "gpt-5-mini" },
    ]);
    const service = makeService(repository);
    const fetchMock = jest.fn();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            message:
              "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          },
        }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(
      service.testConnection({ target: "planner" }, {}, fetchMock as never),
    ).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      max_tokens: 1,
    });
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody).toMatchObject({ max_completion_tokens: 1 });
    expect(retryBody.max_tokens).toBeUndefined();
  });

  it("testConnection surfaces a 400 unrelated to max_tokens without retrying", async () => {
    const repository = repositoryMock([
      { key: "planner.llmApiUrl", value: "https://llm.test/v1/chat" },
      { key: "planner.llmApiKey", value: "db-key" },
      { key: "planner.llmModel", value: "gpt-5-mini" },
    ]);
    const service = makeService(repository);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "model not found",
    });

    await expect(
      service.testConnection({ target: "planner" }, {}, fetchMock as never),
    ).resolves.toMatchObject({
      ok: false,
      message: "LLM 응답 400: model not found",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
