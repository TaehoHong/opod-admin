import { UNION_ENVELOPE_KEY } from "../../prompts/strict-schema";
import { PostPipelineV3Runner } from "./post-pipeline-v3.runner";

function draft(
  conceptJson: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "draft-1",
    characterId: "character-1",
    status: "generating",
    attemptCount: 1,
    conceptJson,
    character: {
      displayName: "서린",
      bio: "카페를 좋아한다",
      interests: ["사진"],
      contentLanguage: "ko",
      personas: [
        { title: "content_style", content: "사소한 일상을 구체적으로 쓴다" },
        { title: "voice", content: "짧은 반말 한 문장" },
      ],
      memories: [],
      posts: [],
      visualProfile: {
        appearancePrompt: "black bob hair",
        stylePrompt: "ordinary phone photo",
        negativePrompt: "logos",
        referenceMedia: [],
      },
    },
    ...overrides,
  };
}

function setup(currentDraft: Record<string, unknown>, fetchResult?: unknown) {
  const repository = {
    findPlannedDraft: jest.fn().mockResolvedValue(currentDraft),
    findAvailableLocations: jest.fn().mockResolvedValue([]),
    persistV3Paused: jest.fn().mockResolvedValue(true),
    persistV3Artifact: jest.fn().mockResolvedValue(true),
    persistV3PromptJobs: jest.fn().mockResolvedValue(true),
    requeueOrFailV3: jest.fn().mockResolvedValue(undefined),
  };
  const settings = {
    resolvePlannerSettings: jest.fn().mockResolvedValue({
      apiUrl: "https://llm.test/v1/chat",
      apiKey: "key",
      model: "gpt-5-mini",
    }),
    resolveProviderSettings: jest.fn().mockResolvedValue({
      editModel: "fal-ai/nano-banana-pro/edit",
      t2iModel: "fal-ai/nano-banana-pro",
    }),
  };
  // PostPlan·ImagePlan은 판별 union이라 프로바이더가 envelope로 감싼 JSON을
  // 돌려준다 (prompts/strict-schema.ts). 스텁도 같은 와이어 포맷을 쓴다.
  const fetchMock = jest.fn().mockResolvedValue(
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ [UNION_ENVELOPE_KEY]: fetchResult }),
          },
        },
      ],
    }),
  );
  const llmLogs = {
    runJsonFetchWithLog: jest.fn(async ({ execute }) => ({
      response: await execute(),
      logId: "101",
    })),
  };
  const runner = new PostPipelineV3Runner(
    repository as never,
    settings as never,
    llmLogs as never,
    { draftWorker: { maxShots: 3, maxAttempts: 3 } } as never,
    () => 0.5,
    fetchMock as never,
  );
  return { runner, repository, settings, fetchMock };
}

describe("PostPipelineV3Runner", () => {
  it("pauses before an LLM call when the writing profile is incomplete", async () => {
    const current = draft(
      {
        pipelineVersion: "post-pipeline-v3",
        pipeline: {
          stage: "post_plan",
          state: "running",
          imageCount: null,
          reasonCodes: [],
        },
      },
      {
        character: {
          ...draft({}).character,
          personas: [{ title: "voice", content: "짧은 반말" }],
        },
      },
    );
    const { runner, repository, fetchMock } = setup(current);

    await runner.runCurrentStage("draft-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "post_plan",
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            state: "needs_input",
            reasonCodes: ["missing_content_style"],
          }),
        }),
      }),
    );
  });

  it("stores a ready PostPlan revision and the orchestrator-owned random imageCount", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v3",
      source: "scheduler",
      mode: "auto",
      operatorRequest: null,
      pipeline: {
        stage: "post_plan",
        state: "running",
        imageCount: null,
        reasonCodes: [],
      },
    });
    const { runner, repository } = setup(current, {
      status: "ready",
      intent: {
        premise: "카페에 먼저 도착했다.",
        primaryPurpose: "일찍 온 민망함을 기록한다.",
        secondaryPurpose: null,
      },
      caption: "또 너무 일찍 옴",
      captionLanguages: ["ko"],
      hashtags: [],
      newMemoryCandidates: [],
    });

    await runner.runCurrentStage("draft-1");

    expect(repository.persistV3Artifact).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.objectContaining({
          stage: "post_plan",
          revision: null,
        }),
        conceptJson: expect.objectContaining({
          postPlanning: expect.objectContaining({
            revision: 1,
            producerLogId: "101",
          }),
          pipeline: {
            stage: "image_plan",
            state: "pending",
            imageCount: 2,
            reasonCodes: [],
          },
        }),
      }),
    );
  });

  it("reduces only an insufficient multi-shot request and retries the same stage", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v3",
      source: "scheduler",
      pipeline: {
        stage: "image_plan",
        state: "running",
        imageCount: 2,
        reasonCodes: [],
      },
      postPlanning: {
        revision: 1,
        hash: "sha256:post",
        output: {
          status: "ready",
          intent: {
            premise: "빈 잔을 본다.",
            primaryPurpose: "기다림을 기록한다.",
            secondaryPurpose: null,
          },
          caption: "다 마심",
          captionLanguages: ["ko"],
          hashtags: [],
          newMemoryCandidates: [],
        },
      },
    });
    const { runner, repository } = setup(current, {
      status: "blocked",
      reasons: [
        {
          code: "insufficient_distinct_shots",
          detail: "두 번째 역할을 만들 수 없다",
        },
      ],
    });

    await runner.runCurrentStage("draft-1");

    expect(repository.persistV3Artifact).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "DRAFT_V3_IMAGE_COUNT_REDUCED",
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            stage: "image_plan",
            state: "pending",
            imageCount: 1,
          }),
        }),
      }),
    );
    expect(repository.persistV3Paused).not.toHaveBeenCalled();
  });
});
