import { POST_AGENT_CONTRACTS } from "../../prompts/post-agent-contracts";
import { EMPTY_CONTENT_PROFILE } from "../character-content-profiles/character-content-profile";
import { UNION_ENVELOPE_KEY } from "../../prompts/strict-schema";
import { PostPipelineV3Runner } from "./post-pipeline-v3.runner";
import { ImagePlanReady } from "./image-planner";

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
  options: {
    captionShots?: unknown[];
    readMedia?: boolean;
    profile?: typeof EMPTY_CONTENT_PROFILE;
    savedAgent?: boolean;
    missingAgent?: boolean;
    imageAgent?: boolean;
  } = {},
) {
  const repository = {
    findPlannedDraft: jest.fn().mockResolvedValue(currentDraft),
    findAvailableLocations: jest.fn().mockResolvedValue([]),
    findRecentVisualPlanDrafts: jest.fn().mockResolvedValue([]),
    findCaptionShots: jest.fn().mockResolvedValue(options.captionShots ?? []),
    persistV3Paused: jest.fn().mockResolvedValue(true),
    persistV3Artifact: jest.fn().mockResolvedValue(true),
    persistV3PromptJobs: jest.fn().mockResolvedValue(true),
    requeueOrFailV3: jest.fn().mockResolvedValue(undefined),
  };
  const settings = {
    resolveAspectRatios: jest.fn().mockResolvedValue({
      feed: { value: "4:5" },
      story: { value: "9:16" },
      reel: { value: "9:16" },
    }),
    resolvePlannerSettings: jest.fn().mockResolvedValue({
      apiUrl: "https://llm.test/v1/chat",
      apiKey: "key",
      model: "gpt-5-mini",
    }),
    resolveImageModelSettings: jest.fn().mockResolvedValue({
      provider: "openai",
      editModel: "gpt-image-2.5-sunburst",
      t2iModel: "gpt-image-2.5-sunburst",
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
    {
      get: jest
        .fn()
        .mockResolvedValue(options.profile ?? EMPTY_CONTENT_PROFILE),
    } as never,
    () => 0.5,
    fetchMock as never,
    options.readMedia === false ? null : readMedia,
    !options.missingAgent
      ? ({
          execution: jest.fn(
            async (stage: keyof typeof POST_AGENT_CONTRACTS) =>
              stage === "generation" && !options.imageAgent
                ? null
                : {
                    ...POST_AGENT_CONTRACTS[stage],
                    ...(stage === "generation" && options.imageAgent
                      ? {
                          id: "17",
                          revision: 3,
                          aiModelId: "2",
                          model: null,
                          effectiveModel: "gpt-image-2.5-sunburst",
                          provider: "openai",
                          systemPrompt: null,
                        }
                      : {
                          id: "7",
                          revision: 2,
                          aiModelId: "9",
                          model: "stage-model",
                          effectiveModel: "stage-model",
                          provider: "openai-compatible",
                          systemPrompt: "Saved system instruction",
                        }),
                  },
          ),
        } as never)
      : undefined,
    {
      retrieve: jest.fn().mockResolvedValue({
        identityReferences: [],
        locationReferences: {},
        trace: { model: "test" },
      }),
    } as never,
    {
      retrieve: jest.fn().mockResolvedValue({
        selectedIds: [],
        trace: { model: "fixture-memory" },
      }),
    } as never,
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

function readyPostPlan() {
  return {
    status: "ready",
    accountFit: "사소한 일상을 구체적으로 공유하는 계정 방향을 유지한다.",
    intent: {
      premise: "카페에 먼저 도착했다.",
      primaryPurpose: "일찍 온 민망함을 기록한다.",
      secondaryPurpose: null,
    },
    newMemoryCandidates: [],
  };
}

describe("PostPipelineV3Runner", () => {
  it("preserves an ungrounded conflict and pauses without requeueing", async () => {
    const output = {
      status: "conflict",
      conflicts: [
        {
          left: { source: "operatorRequest", text: "광고를 쓴다" },
          right: {
            source: "persona.characterContext",
            text: "광고는 쓰지 않는다",
          },
          reason: "요청과 설정이 충돌한다",
        },
      ],
    };
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: {
        stage: "post_plan",
        state: "running",
        imageCount: null,
        reasonCodes: [],
      },
    });
    const { runner, repository } = setup(current, output);
    await runner.runCurrentStage("draft-1");
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: expect.objectContaining({
          rejectedAgentResponse: expect.objectContaining({
            output,
            producerLogId: "101",
          }),
          pipeline: expect.objectContaining({
            state: "needs_input",
            failure: expect.objectContaining({ retryable: false }),
          }),
        }),
      }),
    );
    expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
  });

  it("preserves an invalid blocker without reducing image count or creating jobs", async () => {
    const output = {
      status: "blocked",
      reasons: [
        {
          code: "insufficient_distinct_shots",
          detail: "두 장의 요구를 충족할 수 있으므로 차단 사유가 없다",
        },
      ],
    };
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: {
        stage: "image_plan",
        state: "running",
        imageCount: 2,
        reasonCodes: [],
      },
      postPlanning: {
        revision: 1,
        hash: "post",
        output: {
          status: "ready",
          intent: {
            premise: "동네 간판을 기록한다",
            primaryPurpose: "산책 기록",
            secondaryPurpose: null,
          },
        },
      },
    });
    const { runner, repository } = setup(current, output);
    await runner.runCurrentStage("draft-1");
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: expect.objectContaining({
          rejectedAgentResponse: expect.objectContaining({
            output,
            producerLogId: "101",
          }),
          pipeline: expect.objectContaining({
            state: "needs_input",
            imageCount: 2,
          }),
        }),
      }),
    );
    expect(repository.persistV3Artifact).not.toHaveBeenCalled();
    expect(repository.persistV3PromptJobs).not.toHaveBeenCalled();
    expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
  });
  it.each([
    [
      "publication style wins",
      " phone photo ",
      "editorial",
      "phone photo",
      "partial",
    ],
    ["blank profile falls back", "  ", " film photo ", "film photo", "partial"],
    ["no style stays unspecified", "", "", null, "partial"],
    [
      "no-character photo keeps style",
      "monochrome",
      "editorial",
      "monochrome",
      "none",
    ],
  ] as const)(
    "%s through planning and prompting even after settings change",
    async (_label, imageStyle, legacyStyle, expectedStyle, mode) => {
      const current = captionStageDraft();
      current.character.visualProfile.stylePrompt = legacyStyle;
      const imagePlan: ImagePlanReady = {
        status: "ready",
        locationId: null,
        continuity: { lockedElements: [] },
        shots: [
          {
            sortOrder: 0,
            visualPurpose: "이번 순간의 기록",
            scene:
              mode === "none" ? "A table by the window" : "A hand on a table",
            captureSetup: "Viewed from above",
            characterPresentation: {
              mode,
              visibleParts: mode === "none" ? [] : ["hand"],
              faceVisible: false,
              identityPreservationRequired: false,
            },
            subjectState: "",
            motionEvidence: "",
            notInFrame: [],
            subjectCameraRelation:
              mode === "none" ? "not_applicable" : "aware_unposed",
            referenceBindings: [],
          },
        ],
      };
      const planning = setup(
        {
          ...current,
          conceptJson: {
            ...current.conceptJson,
            pipeline: { stage: "image_plan", state: "running", imageCount: 1 },
          },
        },
        imagePlan,
        { profile: { ...EMPTY_CONTENT_PROFILE, imageStyle } },
      );
      await planning.runner.runCurrentStage("draft-1");
      expect(planning.repository.requeueOrFailV3).not.toHaveBeenCalled();
      const planningInput = JSON.parse(
        JSON.parse(planning.fetchMock.mock.calls[0][1].body).messages[1]
          .content,
      );
      expect(planningInput.contentProfile.imageStyle).toBe(expectedStyle ?? "");
      expect(planningInput.characterVisualContext.visualStyle).toBeUndefined();
      const concept =
        planning.repository.persistV3Artifact.mock.calls[0][0].conceptJson;
      current.character.visualProfile.stylePrompt = "changed legacy style";
      const prompting = setup(
        {
          ...current,
          conceptJson: {
            ...concept,
            pipeline: { ...concept.pipeline, state: "running" },
          },
        },
        undefined,
        {
          profile: {
            ...EMPTY_CONTENT_PROFILE,
            imageStyle: "changed publication style",
          },
        },
      );
      prompting.fetchMock.mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    {
                      sortOrder: 0,
                      prompt: "The planned scene.",
                      negativePrompt: null,
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      await prompting.runner.runCurrentStage("draft-1");
      expect(prompting.repository.requeueOrFailV3).not.toHaveBeenCalled();
      const promptInput = JSON.parse(
        JSON.parse(prompting.fetchMock.mock.calls[0][1].body).messages[1]
          .content,
      );
      expect(promptInput.subjectContract.visualStyle).toBe(expectedStyle);
      if (mode === "none")
        expect(promptInput.subjectContract.appearance).toBe("");
      expect(
        prompting.repository.persistV3PromptJobs.mock.calls[0][0].conceptJson
          .promptBuild.input.subjectContract.visualStyle,
      ).toBe(expectedStyle);
    },
  );

  it.each([
    [
      {
        contentProfile: { imageStyle: "saved publication" },
        characterVisualContext: { visualStyle: "saved legacy" },
      },
      "saved publication",
    ],
    [
      {
        contentProfile: { imageStyle: " " },
        characterVisualContext: { visualStyle: "saved legacy" },
      },
      "saved legacy",
    ],
    [
      { characterVisualContext: { visualStyle: "saved legacy" } },
      "saved legacy",
    ],
    [{ characterVisualContext: { visualStyle: "" } }, null],
    [undefined, "ordinary phone photo"],
  ])(
    "uses recorded style in older artifacts, falling back only without a snapshot (%j)",
    async (input, expectedStyle) => {
      const current = captionStageDraft();
      const concept = current.conceptJson as {
        pipeline: { stage: string };
        imagePlanning: { input?: unknown };
      };
      concept.pipeline.stage = "image_prompt";
      concept.imagePlanning.input = input;
      const { runner, repository, fetchMock } = setup(current);
      fetchMock.mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    {
                      sortOrder: 0,
                      prompt: "The planned scene.",
                      negativePrompt: null,
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      await runner.runCurrentStage("draft-1");
      expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
      const promptInput = JSON.parse(
        JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content,
      );
      expect(promptInput.subjectContract.visualStyle).toBe(expectedStyle);
    },
  );

  it("carries the selected location exclusions into prompt generation before resolving them", async () => {
    const current = captionStageDraft();
    const plan = {
      status: "ready",
      locationId: "cafe-1",
      continuity: { lockedElements: [] },
      shots: [
        {
          sortOrder: 0,
          visualPurpose: "커피 기록",
          scene: "탁자 위의 컵",
          captureSetup: "위에서 내려다본다",
          characterPresentation: {
            mode: "none",
            visibleParts: [],
            faceVisible: false,
            identityPreservationRequired: false,
          },
          subjectState: "",
          motionEvidence: "",
          notInFrame: [],
          subjectCameraRelation: "not_applicable",
          referenceBindings: [],
        },
      ],
    };
    const planning = setup(
      {
        ...current,
        character: {
          ...current.character,
          visualProfile: {
            ...current.character.visualProfile,
            providerConfig: { size: "1536x1024" },
          },
        },
        conceptJson: {
          ...current.conceptJson,
          pipeline: { stage: "image_plan", state: "running", imageCount: 1 },
        },
      },
      plan,
    );
    planning.repository.findAvailableLocations.mockResolvedValue([
      {
        id: "cafe-1",
        displayName: "카페",
        description: "카페",
        negativePrompt: "neon signs",
        references: [],
      },
      {
        id: "other",
        displayName: "다른 장소",
        description: "다른 장소",
        negativePrompt: "flowers",
        references: [],
      },
    ]);
    await planning.runner.runCurrentStage("draft-1");
    expect(planning.repository.requeueOrFailV3).not.toHaveBeenCalled();
    const concept =
      planning.repository.persistV3Artifact.mock.calls[0][0].conceptJson;
    expect(concept.imagePlanning.locationExclusions).toEqual(["neon signs"]);
    const planningInput = JSON.parse(
      JSON.parse(planning.fetchMock.mock.calls[0][1].body).messages[1].content,
    );
    expect(planningInput.canvas).toEqual({ aspectRatio: 1.5 });
    expect(planningInput.characterVisualContext.exclusions).toEqual(["logos"]);
    expect(planningInput.locations[0].exclusions).toEqual(["neon signs"]);
    expect(planningInput.locations[1].exclusions).toEqual(["flowers"]);
    current.character.visualProfile.negativePrompt = "changed exclusion";

    const prompting = setup({
      ...current,
      conceptJson: {
        ...concept,
        pipeline: { ...concept.pipeline, state: "running" },
      },
    });
    prompting.fetchMock.mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                shots: [
                  {
                    sortOrder: 0,
                    prompt:
                      "An unbranded cup on a table, viewed from above. No neon signs.",
                    negativePrompt: null,
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    await prompting.runner.runCurrentStage("draft-1");
    expect(prompting.repository.requeueOrFailV3).not.toHaveBeenCalled();
    const body = JSON.parse(
      prompting.fetchMock.mock.calls[0][1].body as string,
    );
    const promptInput = JSON.parse(body.messages[1].content);
    expect(promptInput.canvas).toEqual({ aspectRatio: 1.5 });
    expect(promptInput.subjectContract.exclusionSources).toEqual([
      { source: "character", exclusions: ["logos"] },
      { source: "location", exclusions: ["neon signs"] },
    ]);
    expect(promptInput.subjectContract.exclusions).toBeUndefined();
    const saved = prompting.repository.persistV3PromptJobs.mock.calls[0][0];
    expect(saved.jobs[0].paramsJson._v3).toMatchObject({
      exclusionsResolved: true,
      negativePrompt: null,
      generationParams: { aspect_ratio: "4:5", size: "1536x1024" },
    });
  });

  it.each([null, "legacy-location"])(
    "preserves exclusion handling for older image plans at %s",
    async (locationId) => {
      const current = captionStageDraft();
      const concept = current.conceptJson as {
        pipeline: Record<string, unknown>;
        imagePlanning: { output: { locationId: string | null } };
      };
      concept.pipeline = {
        stage: "image_prompt",
        state: "running",
        imageCount: 1,
      };
      concept.imagePlanning.output.locationId = locationId;
      const { runner, repository, fetchMock } = setup(current);
      fetchMock.mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    {
                      sortOrder: 0,
                      prompt: "A person reflected in a mirror.",
                      negativePrompt: null,
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      await runner.runCurrentStage("draft-1");
      expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
      expect(
        repository.persistV3PromptJobs.mock.calls[0][0].jobs[0].paramsJson._v3
          .exclusionsResolved,
      ).toBe(locationId === null);
    },
  );

  it("does not fall back to legacy editorial personas when no content profile is configured", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: { stage: "post_plan", state: "running" },
    });
    const { runner, fetchMock } = setup(current, readyPostPlan());
    await runner.runCurrentStage("draft-1");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const input = JSON.parse(body.messages[1].content);
    expect(input.contentProfile).toEqual({
      accountConcept: "",
      constraints: "",
    });
    expect(body.messages[1].content).not.toContain(
      "사소한 일상을 구체적으로 쓴다",
    );
    expect(input.persona.writingProfile.voice).toEqual([
      { title: "voice", content: "짧은 반말 한 문장" },
    ]);
  });

  it.each(["feed", "reel"])(
    "supplies the actual image pipeline medium for %s without rewriting the request",
    async (contentType) => {
      const current = draft(
        {
          pipelineVersion: "post-pipeline-v4",
          operatorRequest: "카페에서 쉬는 순간을 영상으로만 올려줘",
          pipeline: { stage: "post_plan", state: "running" },
        },
        { contentType },
      );
      const { runner, repository, fetchMock } = setup(current, readyPostPlan());
      await runner.runCurrentStage("draft-1");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const input = JSON.parse(body.messages[1].content);
      expect(input.productionContext).toEqual({
        contentType,
        mediaType: "image",
      });
      expect(input.operatorRequest).toBe(
        "카페에서 쉬는 순간을 영상으로만 올려줘",
      );
      expect(input).not.toHaveProperty("imageCount");
      expect(
        repository.persistV3Artifact.mock.calls[0][0].conceptJson.postPlanning
          .input,
      ).toEqual(input);
    },
  );

  it.each([undefined, "카페에서 쉬는 순간"])(
    "always supplies authored account concept with request=%s",
    async (operatorRequest) => {
      const current = draft({
        pipelineVersion: "post-pipeline-v4",
        operatorRequest,
        pipeline: { stage: "post_plan", state: "running" },
      });
      const profile = {
        accountConcept: "러닝 기록과 훈련 전후 일상",
        imageStyle: "사진 전용 지침",
        captionStyle: "캡션 전용 지침",
        constraints: "협찬 금지",
      };
      const { runner, repository, fetchMock } = setup(
        current,
        readyPostPlan(),
        { profile },
      );
      await runner.runCurrentStage("draft-1");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const input = JSON.parse(body.messages[1].content);
      expect(input.contentProfile).toEqual({
        accountConcept: profile.accountConcept,
        constraints: profile.constraints,
      });
      expect(body.messages[1].content).not.toContain(profile.imageStyle);
      expect(body.messages[1].content).not.toContain(profile.captionStyle);
      expect(body.messages[1].content).not.toContain(
        "사소한 일상을 구체적으로 쓴다",
      );
      expect(
        repository.persistV3Artifact.mock.calls[0][0].conceptJson.postPlanning
          .input.contentProfile,
      ).toEqual(input.contentProfile);
    },
  );

  it("plans from v2 roles without legacy titles and excludes private source text", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      operatorRequest: "강릉에서 보낸 하루",
      pipeline: { stage: "post_plan", state: "running" },
    });
    const { runner, repository, fetchMock } = setup(
      {
        ...current,
        character: {
          ...current.character,
          personas: [
            {
              id: "source-v2",
              schemaVersion: 2,
              title: "인물 설정",
              content: "꽃집에서 일한다.짧게 말한다.제작자 비밀.처음 인사.",
              fragments: [
                {
                  id: "identity",
                  kind: "identity",
                  injection: "always",
                  content: "꽃집에서 일한다.",
                  recallKeys: [],
                  canonIds: [],
                },
                {
                  id: "voice",
                  kind: "voice",
                  injection: "always",
                  content: "짧게 말한다.",
                  recallKeys: [],
                  canonIds: [],
                },
                {
                  id: "private",
                  kind: "creator_note",
                  injection: "never_prompt",
                  content: "제작자 비밀.",
                  recallKeys: ["강릉"],
                  canonIds: [],
                },
                {
                  id: "greeting",
                  kind: "greeting",
                  injection: "start_only",
                  content: "처음 인사.",
                  recallKeys: [],
                  canonIds: [],
                },
              ],
            },
          ],
        },
      },
      readyPostPlan(),
    );

    await runner.runCurrentStage("draft-1");

    expect(repository.persistV3Artifact).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_V3_POST_PLAN_READY" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const input = JSON.parse(body.messages[1].content);
    expect(input.persona.characterContext).toContainEqual(
      expect.objectContaining({
        sourceId: "source-v2",
        fragmentId: "identity",
        schemaVersion: 2,
        kind: "identity",
        content: "꽃집에서 일한다.",
      }),
    );
    expect(input.persona.writingProfile.voice).toContainEqual(
      expect.objectContaining({ kind: "voice", content: "짧게 말한다." }),
    );
    expect(body.messages[1].content).not.toContain("제작자 비밀");
    expect(body.messages[1].content).not.toContain("처음 인사");
  });

  it.each(["image_plan", "caption"])(
    "keeps v2 routing and boundaries when passing the plan to %s",
    async (stage) => {
      const current = captionStageDraft();
      const fragments = [
        { kind: "identity", injection: "always", content: "꽃집에서 일한다." },
        { kind: "voice", injection: "always", content: "짧게 말한다." },
        {
          kind: "boundary",
          injection: "always",
          content: "직장 주소는 숨긴다.",
        },
        { kind: "example", injection: "always", content: "예시 속 허구 사건." },
        {
          kind: "creator_note",
          injection: "never_prompt",
          content: "제작자 비밀.",
        },
        {
          kind: "greeting",
          injection: "start_only",
          content: "대화 시작 인사.",
        },
        {
          kind: "judgment",
          injection: "retrieved",
          content: "운동은 천천히 배운다.",
        },
      ].map((entry, i) => ({
        ...entry,
        id: `fragment-${i}`,
        recallKeys: ["필라테스"],
        canonIds: [],
      }));
      const { runner, fetchMock, repository } = setup(
        {
          ...current,
          conceptJson: {
            ...current.conceptJson,
            pipeline: {
              stage,
              state: "running",
              imageCount: 1,
              reasonCodes: [],
            },
          },
          character: {
            ...current.character,
            personas: [
              {
                id: "source",
                schemaVersion: 2,
                title: "인물",
                content: fragments.map((item) => item.content).join(""),
                fragments,
              },
            ],
          },
        },
        stage === "caption"
          ? {
              status: "ready",
              caption: "운동 끝.",
              captionLanguages: ["ko"],
              hashtags: [],
            }
          : {
              status: "blocked",
              reasons: [
                {
                  code: "insufficient_distinct_shots",
                  detail: "촬영 근거 부족",
                  evidence: {
                    requirements: [
                      {
                        path: "contentProfile.constraints",
                        quote: "협찬 금지",
                      },
                    ],
                    referenceChecks: [],
                    alternatives: [
                      {
                        description: "제약을 충족할 수 없다",
                        satisfiesRequirements: false,
                      },
                    ],
                  },
                },
              ],
            },
        {
          profile: {
            accountConcept: "운동 중심 일상",
            imageStyle: "사진만의 구도",
            captionStyle: "캡션만의 어투",
            constraints: "협찬 금지",
          },
          captionShots: [
            {
              sortOrder: 0,
              jobId: "job",
              mediaId: "media",
              media: {
                url: "https://cdn.local/image.png",
                storageKey: null,
                contentType: "image/png",
              },
            },
          ],
        },
      );

      await runner.runCurrentStage("draft-1");

      expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const serialized =
        stage === "caption"
          ? body.messages[1].content[0].text
          : body.messages[1].content;
      const input = JSON.parse(serialized);
      expect(input.contentProfile).toEqual({
        accountConcept: "운동 중심 일상",
        constraints: "협찬 금지",
        ...(stage === "caption"
          ? { captionStyle: "캡션만의 어투" }
          : { imageStyle: "사진만의 구도" }),
      });
      expect(serialized).not.toContain(
        stage === "caption" ? "사진만의 구도" : "캡션만의 어투",
      );
      expect(serialized).not.toContain("제작자 비밀");
      expect(serialized).not.toContain("대화 시작 인사");
      expect(serialized).not.toContain("예시 속 허구 사건");
      const context =
        stage === "caption"
          ? input.persona.characterContext
          : input.characterVisualContext.personaContext;
      expect(context).toContainEqual(
        expect.objectContaining({
          kind: "judgment",
          sourceId: "source",
          content: "운동은 천천히 배운다.",
        }),
      );
      if (stage === "caption") {
        expect(input.persona.boundaries).toContainEqual(
          expect.objectContaining({
            kind: "boundary",
            content: "직장 주소는 숨긴다.",
          }),
        );
        expect(input.persona.writingProfile.voice).toContainEqual(
          expect.objectContaining({ kind: "voice" }),
        );
      } else {
        expect(input.characterVisualContext.boundaries).toEqual([
          "직장 주소는 숨긴다.",
        ]);
      }
    },
  );

  it("pauses a v2 source without fragments instead of leaking its raw body", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: { stage: "post_plan", state: "running" },
    });
    const { runner, repository, fetchMock } = setup({
      ...current,
      character: {
        ...current.character,
        personas: [
          {
            id: "v2",
            schemaVersion: 2,
            title: "identity",
            content: "private unsplit source",
            fragments: [],
          },
          ...current.character.personas,
        ],
      },
    });
    await runner.runCurrentStage("draft-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            state: "needs_input",
            reasonCodes: ["invalid_persona_structure"],
          }),
        }),
      }),
    );
  });

  it("pauses when common character context is absent even if a content profile exists", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: { stage: "post_plan", state: "running" },
    });
    current.character.bio = "";
    current.character.personas = [{ title: "voice", content: "짧은 반말" }];
    const { runner, repository, fetchMock } = setup(current, readyPostPlan(), {
      profile: { ...EMPTY_CONTENT_PROFILE, accountConcept: "러닝" },
    });
    await runner.runCurrentStage("draft-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            reasonCodes: ["missing_character_context"],
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
    const { runner, repository } = setup(current, readyPostPlan());

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
          evidence: {
            requirements: [
              { path: "postPlan.intent.premise", quote: "빈 잔을 본다." },
            ],
            referenceChecks: [],
            alternatives: [
              {
                description: "의미를 유지하는 두 번째 구도를 구성할 수 없다",
                satisfiesRequirements: false,
              },
            ],
          },
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

  it("sends visual persona, memory, soft capture preferences, and recent plans to image planning", async () => {
    const base = draft({});
    const current = draft(
      {
        pipelineVersion: "post-pipeline-v4",
        pipeline: {
          stage: "image_plan",
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
              premise: "현상한 필름을 책상에 펼친다.",
              primaryPurpose: "첫 롤을 기록한다.",
              secondaryPurpose: null,
            },
            newMemoryCandidates: [],
          },
        },
      },
      {
        character: {
          ...base.character,
          personas: [
            ...base.character.personas,
            { title: "capture_style", content: "혼자면 고정면 셀프타이머" },
            { title: "world", content: "연남동 원룸에 산다" },
          ],
          memories: [{ type: "episodic", content: "비 오는 날 우산을 샀다" }],
        },
      },
    );
    const { runner, repository } = setup(current, {
      status: "blocked",
      reasons: [
        {
          code: "missing_identity_reference",
          detail: "정체성 레퍼런스 없음",
          evidence: {
            requirements: [
              {
                path: "postPlan.intent.premise",
                quote: "현상한 필름을 책상에 펼친다.",
              },
            ],
            referenceChecks: [],
            alternatives: [
              {
                description: "제약을 충족할 참조가 없다",
                satisfiesRequirements: false,
              },
            ],
          },
        },
      ],
    });
    repository.findRecentVisualPlanDrafts.mockResolvedValue([
      {
        id: "malformed-draft",
        status: "planned",
        createdAt: new Date("2026-08-18T00:00:00.000Z"),
        publishedPostId: null,
        conceptJson: null,
      },
      {
        id: "blocked-draft",
        status: "planned",
        createdAt: new Date("2026-08-17T12:00:00.000Z"),
        publishedPostId: null,
        conceptJson: {
          imagePlanning: { output: { status: "blocked", reasons: [] } },
        },
      },
      {
        id: "older-draft",
        status: "planned",
        createdAt: new Date("2026-08-17T00:00:00.000Z"),
        publishedPostId: null,
        conceptJson: {
          postPlanning: {
            output: {
              status: "ready",
              intent: { premise: "창가에서 우산을 말린다" },
            },
          },
          imagePlanning: {
            output: {
              status: "ready",
              shots: [
                {
                  sortOrder: 0,
                  visualPurpose: "젖은 날의 여운",
                  scene: "창가에 기대 우산을 내려다본다",
                  captureSetup: "맞은편 허리 높이",
                  characterPresentation: { mode: "partial" },
                  subjectCameraRelation: "unaware",
                },
                ...Array.from({ length: 12 }, (_, index) => ({
                  sortOrder: index + 1,
                  visualPurpose: `추가 컷 ${index + 1}`,
                  scene: `추가 장면 ${index + 1}`,
                  captureSetup: `추가 촬영 ${index + 1}`,
                  characterPresentation: { mode: "partial" },
                  subjectCameraRelation: "aware_unposed",
                })),
              ],
            },
          },
        },
      },
    ]);

    await runner.runCurrentStage("draft-1");

    const paused = repository.persistV3Paused.mock.calls[0][0] as {
      conceptJson: {
        imagePlanning: {
          input: {
            characterVisualContext: Record<string, unknown>;
            memories: unknown[];
            recentVisualHistory: { shots: unknown[] }[];
          };
        };
      };
    };
    const context =
      paused.conceptJson.imagePlanning.input.characterVisualContext;
    expect(context.capturePreferences).toEqual([]);
    expect(context.personaContext).toEqual(
      expect.arrayContaining([
        { title: "world", content: "연남동 원룸에 산다" },
      ]),
    );
    expect(paused.conceptJson.imagePlanning.input.memories).toEqual([
      { type: "episodic", content: "비 오는 날 우산을 샀다" },
    ]);
    expect(
      paused.conceptJson.imagePlanning.input.recentVisualHistory[0],
    ).toMatchObject({
      publicationState: "unpublished",
      premise: "창가에서 우산을 말린다",
      shots: expect.arrayContaining([
        {
          visualPurpose: "젖은 날의 여운",
          scene: "창가에 기대 우산을 내려다본다",
          captureSetup: "맞은편 허리 높이",
          characterPresentation: "partial",
          subjectCameraRelation: "unaware",
        },
      ]),
    });
    expect(
      paused.conceptJson.imagePlanning.input.recentVisualHistory.flatMap(
        (entry) => entry.shots,
      ),
    ).toHaveLength(12);
    expect(repository.findRecentVisualPlanDrafts).toHaveBeenCalledWith(
      "character-1",
      "draft-1",
      8,
    );
  });

  // ⑥ 캡션: 산출물 저장과 게시 컬럼 갱신이 한 CAS 트랜잭션이고, 다음 단계는
  // 검수가 아니라 게시 대기다. 이미지가 vision 블록으로 실제 전송돼야 한다.
  it.each([
    {
      kind: "text",
      caption: "필라테스 끝나고 한 컷,, 오늘도 완룟",
      captionLanguages: ["ko"],
      hashtags: ["필라테스"],
      operatorNote: "이모지 빼고",
    },
    {
      kind: "emoji only",
      caption: "📸",
      captionLanguages: [],
      hashtags: [],
      operatorNote: "📸만 쓰고 해시태그는 빼줘",
    },
  ])(
    "writes a $kind caption from generated images and hands off to publish",
    async ({ caption, captionLanguages, hashtags, operatorNote }) => {
      const { runner, repository, fetchMock, readMedia } = setup(
        captionStageDraft(),
        {
          status: "ready",
          caption,
          captionLanguages,
          hashtags,
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

      await runner.runCurrentStage("draft-1", { operatorNote });

      expect(readMedia).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://cdn.local/0.png" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(
        body.response_format.json_schema.schema.properties.result.anyOf[0]
          .properties.captionLanguages.minItems,
      ).toBe(0);
      const userContent = body.messages[1].content as {
        type: string;
        text?: string;
      }[];
      expect(userContent.some((block) => block.type === "image_url")).toBe(
        true,
      );
      expect(userContent[0].text).toContain("존댓말로 짧게");
      expect(userContent[0].text).toContain(operatorNote);
      expect(userContent[0].text).not.toContain("captureSetup");

      expect(repository.persistV3Artifact).toHaveBeenCalledWith(
        expect.objectContaining({
          expected: expect.objectContaining({
            stage: "caption",
            artifactKey: "captionBuild",
            revision: null,
          }),
          columns: {
            caption,
            hashtags,
          },
          actionType: "DRAFT_V3_CAPTION_READY",
          conceptJson: expect.objectContaining({
            captionBuild: expect.objectContaining({
              revision: 1,
              promptVersion: "caption-writer-v3",
              contractVersion: "caption-set-v2",
              output: { status: "ready", caption, captionLanguages, hashtags },
              source: expect.objectContaining({
                postPlanningHash: "sha256:post",
                generationSetHash: expect.stringMatching(/^sha256:/),
              }),
              input: expect.objectContaining({
                operatorNote,
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
    },
  );

  // ⑦ 게시는 러너의 단계가 아니다. claim 게이트가 뚫려 여기 들어오더라도 초안을
  // failed로 만들면 안 된다 — 게시·캡션 편집·컷 재생성 게이트가 전부
  // state=pending을 요구해서, failed가 되는 순간 되살릴 경로가 사라진다.
  it("releases a draft claimed at the publish stage instead of failing it", async () => {
    const { runner, repository, fetchMock } = setup(
      draft({
        pipelineVersion: "post-pipeline-v4",
        pipeline: {
          stage: "publish",
          state: "running",
          imageCount: 1,
          reasonCodes: [],
        },
        captionBuild: { revision: 1, hash: "sha256:caption" },
      }),
    );

    await runner.runCurrentStage("draft-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "publish",
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            stage: "publish",
            state: "pending",
            reasonCodes: [],
          }),
        }),
      }),
    );
  });

  it("persists an exact structured cause when a provider request fails", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: {
        stage: "post_plan",
        state: "running",
        imageCount: null,
        reasonCodes: [],
      },
    });
    const { runner, repository, fetchMock } = setup(current);
    fetchMock.mockResolvedValue(
      new Response("quota exhausted", { status: 429 }),
    );

    await runner.runCurrentStage("draft-1");

    expect(repository.requeueOrFailV3).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "structured agent failed (429): quota exhausted",
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            state: "pending",
            reasonCodes: ["provider_http_error"],
            failure: expect.objectContaining({
              code: "provider_http_error",
              cause: "AI 제공자가 HTTP 429 오류를 반환했습니다.",
              technicalDetail: "structured agent failed (429): quota exhausted",
            }),
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

describe("saved post agent execution", () => {
  it("uses the generation model policy for prompts and pins the same config to every image job", async () => {
    const current = captionStageDraft();
    (current.conceptJson as { pipeline: { stage: string } }).pipeline.stage =
      "image_prompt";
    const { runner, repository, fetchMock, settings } = setup(
      current,
      undefined,
      { imageAgent: true },
    );
    fetchMock.mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                shots: [
                  {
                    sortOrder: 0,
                    prompt: "An ordinary scene.",
                    negativePrompt: null,
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    await runner.runCurrentStage("draft-1");
    expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
    expect(settings.resolveImageModelSettings).toHaveBeenCalledWith(
      "openai",
      "gpt-image-2.5-sunburst",
    );
    const result = repository.persistV3PromptJobs.mock.calls[0][0];
    expect(result.conceptJson.promptBuild.modelPolicy.id).toBe(
      "gpt-image-natural-language",
    );
    expect(result.jobs[0].paramsJson._postAgent).toEqual({
      promptId: "17",
      revision: 3,
      aiModelId: "2",
      provider: "openai",
      model: "gpt-image-2.5-sunburst",
    });
  });
  it("sends the saved instruction/model/schema to the LLM and records the configuration in the artifact", async () => {
    const current = draft({
      pipelineVersion: "post-pipeline-v4",
      pipeline: { stage: "post_plan", state: "running", imageCount: 1 },
    });
    const result = {
      status: "ready",
      accountFit: "Fits everyday account",
      intent: {
        premise: "A quiet afternoon",
        primaryPurpose: "Daily record",
        secondaryPurpose: null,
      },
      newMemoryCandidates: [],
    };
    const { runner, repository, fetchMock } = setup(current, result, {
      savedAgent: true,
    });
    await runner.runCurrentStage("draft-1");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.model).toBe("stage-model");
    expect(request.messages[0].content).toBe("Saved system instruction");
    expect(request.response_format.json_schema.schema).toEqual(
      POST_AGENT_CONTRACTS.post_plan.outputSchema,
    );
    expect(
      repository.persistV3Artifact.mock.calls[0][0].conceptJson.postPlanning
        .agentConfig,
    ).toMatchObject({
      promptId: "7",
      revision: 2,
      aiModelId: "9",
      provider: "openai-compatible",
      model: "stage-model",
    });
  });
});

describe("required DB prompt settings", () => {
  it.each(["post_plan", "image_plan", "image_prompt", "caption"])(
    "pauses %s before any model call when no prompt is saved",
    async (stage) => {
      const { runner, repository, fetchMock, readMedia } = setup(
        draft({
          pipelineVersion: "post-pipeline-v4",
          pipeline: { stage, state: "running", imageCount: 1 },
        }),
        undefined,
        { missingAgent: true },
      );
      await runner.runCurrentStage("draft-1");
      expect(repository.persistV3Paused).toHaveBeenCalledWith(
        expect.objectContaining({
          conceptJson: expect.objectContaining({
            pipeline: expect.objectContaining({
              stage,
              state: "needs_configuration",
              reasonCodes: [`${stage}_prompt_missing`],
            }),
          }),
        }),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readMedia).not.toHaveBeenCalled();
      expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
    },
  );
});

describe("embedding reference retrieval integration", () => {
  it("retrieves candidates before calling the image planner and records the trace", async () => {
    const current = captionStageDraft();
    (current.conceptJson.pipeline as Record<string, unknown>).stage =
      "image_plan";
    const { runner, repository, fetchMock } = setup(current);
    const trace = {
      model: "embedding-test",
      queries: [{ purpose: "scene", query: "scene" }],
    };
    const retrieve = jest.fn().mockResolvedValue({
      identityReferences: [
        { id: "retrieved-id", description: "retrieved caption" },
      ],
      locationReferences: {},
      trace,
    });
    Object.assign(runner, { referenceRetrieval: { retrieve } });
    await runner.runCurrentStage("draft-1");
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: "character-1" }),
    );
    const input = JSON.parse(
      JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content,
    );
    expect(input.identityReferences).toEqual([
      { id: "retrieved-id", description: "retrieved caption" },
    ]);
    expect(
      repository.persistV3Paused.mock.calls[0][0].conceptJson
        .referenceRetrieval,
    ).toEqual(trace);
  });
});

it("pauses image planning on embedding failure without a planner call or retry", async () => {
  const current = captionStageDraft();
  (current.conceptJson.pipeline as Record<string, unknown>).stage =
    "image_plan";
  const { runner, repository, fetchMock } = setup(current);
  Object.assign(runner, {
    referenceRetrieval: {
      retrieve: jest.fn().mockRejectedValue(new Error("index missing")),
    },
  });
  await runner.runCurrentStage("draft-1");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
  expect(repository.persistV3Paused.mock.calls[0][0].conceptJson).toMatchObject(
    {
      referenceRetrieval: { failure: "index missing" },
      pipeline: {
        state: "needs_configuration",
        reasonCodes: ["reference_retrieval_failed"],
      },
    },
  );
});

describe("semantic Canon pipeline input", () => {
  it.each(["post_plan", "image_plan", "caption"])(
    "passes selected Canon unchanged to %s and records retrieval evidence",
    async (stage) => {
      const current = captionStageDraft();
      (current.conceptJson.pipeline as Record<string, unknown>).stage = stage;
      const selected = {
        sourceId: "selected-canon",
        type: "fact",
        content: "고정 블루블랙 단발",
        kind: "fact",
        injection: "retrieved",
        recallKeys: ["머리"],
      };
      const excluded = {
        sourceId: "excluded-canon",
        type: "episode",
        content: "이전 밤 산책",
        kind: "event",
        injection: "retrieved",
        recallKeys: ["운동"],
      };
      Object.assign(current.character, { memories: [selected, excluded] });
      const { runner, repository, fetchMock } = setup(
        current,
        stage === "caption"
          ? {
              status: "ready",
              caption: "커피 한 잔",
              captionLanguages: ["ko"],
              hashtags: [],
            }
          : undefined,
        {
          captionShots: [
            {
              sortOrder: 0,
              jobId: "job",
              mediaId: "media",
              media: {
                url: "https://cdn.test/1.png",
                storageKey: null,
                contentType: "image/png",
              },
            },
          ],
        },
      );
      const trace = { model: "semantic-test", selectedIds: ["selected-canon"] };
      Object.assign(runner, {
        memoryRetrieval: {
          retrieve: async () => ({ selectedIds: ["selected-canon"], trace }),
        },
      });
      await runner.runCurrentStage("draft-1");
      const messages = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
      const rawInput =
        typeof messages[1].content === "string"
          ? messages[1].content
          : messages[1].content[0].text;
      expect(rawInput).toContain("고정 블루블랙 단발");
      expect(rawInput).toContain("selected-canon");
      expect(rawInput).not.toContain("이전 밤 산책");
      expect(rawInput).not.toContain("excluded-canon");
      const saved =
        stage === "caption"
          ? repository.persistV3Artifact.mock.calls[0][0].conceptJson
          : repository.persistV3Paused.mock.calls[0][0].conceptJson;
      expect(saved.memoryRetrieval[stage]).toEqual(trace);
    },
  );
  it("preserves upstream data and stops without a planner call or retry on memory index failure", async () => {
    const current = captionStageDraft();
    (current.conceptJson.pipeline as Record<string, unknown>).stage =
      "image_plan";
    const before = current.conceptJson.postPlanning;
    const { runner, repository, fetchMock } = setup(current);
    Object.assign(runner, {
      memoryRetrieval: {
        retrieve: async () => {
          throw new Error("memory_embedding_index_required:source");
        },
      },
    });
    await runner.runCurrentStage("draft-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
    expect(
      repository.persistV3Paused.mock.calls[0][0].conceptJson,
    ).toMatchObject({
      postPlanning: before,
      memoryRetrieval: {
        image_plan: { failure: "memory_embedding_index_required:source" },
      },
      pipeline: {
        state: "needs_configuration",
        reasonCodes: ["memory_retrieval_failed"],
      },
    });
  });
});
