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
    findRecentVisualPlanDrafts: jest.fn().mockResolvedValue([]),
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

function readyPostPlan() {
  return {
    status: "ready",
    intent: {
      premise: "카페에 먼저 도착했다.",
      primaryPurpose: "일찍 온 민망함을 기록한다.",
      secondaryPurpose: null,
    },
    newMemoryCandidates: [],
  };
}

describe("PostPipelineV3Runner", () => {
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
                },
              ],
            },
        {
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
            title: "content_style",
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

  it.each([
    ["post-pipeline-v3", "content_guidance"],
    ["post-pipeline-v4", "content_guidance"],
    ["post-pipeline-v4", "content_style"],
  ])(
    "accepts %s drafts with the %s editorial policy title",
    async (pipelineVersion, policyTitle) => {
      const current = draft(
        {
          pipelineVersion,
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
            personas: [
              { title: policyTitle, content: "사소한 일상을 구체적으로 쓴다" },
              { title: "voice", content: "짧은 반말" },
            ],
          },
        },
      );
      const { runner, repository, fetchMock } = setup(current, readyPostPlan());

      await runner.runCurrentStage("draft-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(repository.persistV3Artifact).toHaveBeenCalledWith(
        expect.objectContaining({
          conceptJson: expect.objectContaining({
            postPlanning: expect.objectContaining({
              input: expect.objectContaining({
                persona: expect.objectContaining({
                  writingProfile: expect.objectContaining({
                    contentStyle: [
                      {
                        title: "content_style",
                        content: "사소한 일상을 구체적으로 쓴다",
                      },
                    ],
                  }),
                  additionalContext: [],
                }),
              }),
            }),
          }),
        }),
      );
    },
  );

  it("deduplicates identical editorial policy aliases", async () => {
    const current = draft(
      {
        pipelineVersion: "post-pipeline-v4",
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
          personas: [
            {
              title: "content_style",
              content: "  사소한 일상을 구체적으로 쓴다  ",
            },
            {
              title: "content_guidance",
              content: "사소한 일상을 구체적으로 쓴다",
            },
            { title: "voice", content: "짧은 반말" },
          ],
        },
      },
    );
    const { runner, repository, fetchMock } = setup(current, readyPostPlan());

    await runner.runCurrentStage("draft-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = repository.persistV3Artifact.mock.calls[0][0] as {
      conceptJson: {
        postPlanning: {
          input: {
            persona: {
              writingProfile: { contentStyle: unknown[] };
              additionalContext: unknown[];
            };
          };
        };
      };
    };
    expect(
      stored.conceptJson.postPlanning.input.persona.writingProfile.contentStyle,
    ).toEqual([
      {
        title: "content_style",
        content: "사소한 일상을 구체적으로 쓴다",
      },
    ]);
    expect(
      stored.conceptJson.postPlanning.input.persona.additionalContext,
    ).toEqual([]);
  });

  it("pauses conflicting editorial policy aliases before an LLM call", async () => {
    const current = draft(
      {
        pipelineVersion: "post-pipeline-v4",
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
          personas: [
            { title: "content_style", content: "짧게 쓴다" },
            { title: "content_guidance", content: "길게 설명한다" },
            { title: "voice", content: "짧은 반말" },
          ],
        },
      },
    );
    const { runner, repository, fetchMock } = setup(current, readyPostPlan());

    await runner.runCurrentStage("draft-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.persistV3Paused).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: "post_plan",
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({
            state: "conflict",
            reasonCodes: ["persona_content_policy_conflict"],
          }),
        }),
      }),
    );
    expect(repository.requeueOrFailV3).not.toHaveBeenCalled();
  });

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
        { code: "missing_identity_reference", detail: "정체성 레퍼런스 없음" },
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
    expect(context.capturePreferences).toEqual(["혼자면 고정면 셀프타이머"]);
    expect(context.personaContext).toEqual(
      expect.arrayContaining([
        { title: "content_style", content: "사소한 일상을 구체적으로 쓴다" },
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
