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

function setup(
  currentDraft: Record<string, unknown>,
  fetchResult?: unknown,
  options: { captionShots?: unknown[]; readMedia?: boolean } = {},
) {
  const repository = {
    findPlannedDraft: jest.fn().mockResolvedValue(currentDraft),
    findAvailableLocations: jest.fn().mockResolvedValue([]),
    findCaptionShots: jest.fn().mockResolvedValue(options.captionShots ?? []),
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
  const readMedia = jest.fn(async () => ({
    bytes: Buffer.from("png"),
    contentType: "image/png",
  }));
  const runner = new PostPipelineV3Runner(
    repository as never,
    settings as never,
    llmLogs as never,
    { draftWorker: { maxShots: 3, maxAttempts: 3 } } as never,
    () => 0.5,
    fetchMock as never,
    options.readMedia === false ? null : readMedia,
  );
  return { runner, repository, settings, fetchMock, readMedia };
}

// V4 ⑥ 캡션 단계에 도달한 draft — ②③이 ready이고 ⑤가 컷당 1장을 만들었다.
function captionStageDraft() {
  return draft({
    pipelineVersion: "post-pipeline-v4",
    source: "manual",
    mode: "manual",
    operatorRequest: "존댓말로 짧게",
    pipeline: {
      stage: "caption",
      state: "running",
      imageCount: 1,
      reasonCodes: [],
    },
    postPlanning: {
      revision: 1,
      hash: "sha256:post",
      output: {
        status: "ready",
        intent: {
          premise: "필라테스 다녀와 현관 거울 앞에 섰다.",
          primaryPurpose: "운동 후 기록",
          secondaryPurpose: null,
        },
        newMemoryCandidates: [],
      },
    },
    imagePlanning: {
      revision: 1,
      hash: "sha256:image",
      output: {
        status: "ready",
        locationId: null,
        continuity: { lockedElements: [] },
        shots: [
          {
            sortOrder: 0,
            visualPurpose: "전신 핏",
            scene: "현관 전신거울에 비친 모습",
            captureSetup: "후면 카메라를 거울로",
            characterPresentation: {
              mode: "reflection",
              visibleParts: [],
              faceVisible: false,
              identityPreservationRequired: false,
            },
            referenceBindings: [],
          },
        ],
      },
    },
  });
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
    // post-planner-v2: 캡션 없음 — 캡션은 ⑥ 캡션 단계 소유.
    const { runner, repository } = setup(current, {
      status: "ready",
      intent: {
        premise: "카페에 먼저 도착했다.",
        primaryPurpose: "일찍 온 민망함을 기록한다.",
        secondaryPurpose: null,
      },
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

  // ⑥ 캡션: 산출물 저장과 게시 컬럼 갱신이 한 CAS 트랜잭션이고, 다음 단계는
  // 검수가 아니라 게시 대기다. 이미지가 vision 블록으로 실제 전송돼야 한다.
  it("runs the caption stage on the generated images and hands off to publish", async () => {
    const { runner, repository, fetchMock, readMedia } = setup(
      captionStageDraft(),
      {
        status: "ready",
        caption: "필라테스 끝나고 한 컷,, 오늘도 완룟",
        captionLanguages: ["ko"],
        hashtags: ["#필라테스"],
      },
      {
        captionShots: [
          {
            sortOrder: 0,
            jobId: "job-0",
            mediaId: "media-0",
            media: {
              url: "https://cdn.local/0.png",
              storageKey: null,
              contentType: "image/png",
            },
          },
        ],
      },
    );

    await runner.runCurrentStage("draft-1", { operatorNote: "이모지 빼고" });

    expect(readMedia).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://cdn.local/0.png" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const userContent = body.messages[1].content as {
      type: string;
      text?: string;
    }[];
    expect(userContent.some((block) => block.type === "image_url")).toBe(true);
    expect(userContent[0].text).toContain("존댓말로 짧게");
    expect(userContent[0].text).toContain("이모지 빼고");
    expect(userContent[0].text).not.toContain("captureSetup");

    expect(repository.persistV3Artifact).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.objectContaining({
          stage: "caption",
          artifactKey: "captionBuild",
          revision: null,
        }),
        columns: {
          caption: "필라테스 끝나고 한 컷,, 오늘도 완룟",
          hashtags: ["필라테스"],
        },
        actionType: "DRAFT_V3_CAPTION_READY",
        conceptJson: expect.objectContaining({
          captionBuild: expect.objectContaining({
            revision: 1,
            promptVersion: "caption-writer-v1",
            contractVersion: "caption-set-v1",
            source: expect.objectContaining({
              postPlanningHash: "sha256:post",
              generationSetHash: expect.stringMatching(/^sha256:/),
            }),
            input: expect.objectContaining({
              operatorNote: "이모지 빼고",
              shots: [expect.objectContaining({ mediaId: "media-0" })],
            }),
          }),
          pipeline: expect.objectContaining({
            stage: "publish",
            state: "pending",
          }),
        }),
      }),
    );
  });

  it("pauses the caption stage as needs_configuration when no media reader is wired", async () => {
    const { runner, repository, fetchMock } = setup(
      captionStageDraft(),
      undefined,
      { readMedia: false },
    );

    await runner.runCurrentStage("draft-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "caption",
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            state: "needs_configuration",
            reasonCodes: ["media_reader_missing"],
          }),
        }),
      }),
    );
  });
});
