import { generationSetHash } from "../../worker/post-pipeline-v3";
import { PostWorkspaceRepository } from "./post-workspace.repository";
import { PostWorkspaceService } from "./post-workspace.service";

const draft = {
  id: "draft-1",
  characterId: "character-1",
  contentType: "feed",
  caption: "서린의 새 게시물",
  status: "generating",
  scheduledAt: null,
  publishedPostId: null,
  conceptJson: { source: "manual", mode: "manual", plan: { shots: [{}] } },
  createdAt: new Date("2026-08-10T01:00:00.000Z"),
  updatedAt: new Date("2026-08-10T03:00:00.000Z"),
  publishedPost: null,
  jobs: [
    {
      id: "job-1",
      sortOrder: 0,
      status: "draft",
      prompt: "portrait prompt",
      updatedAt: new Date("2026-08-10T03:00:00.000Z"),
      outputs: [],
    },
  ],
  evaluations: [],
};

const post = {
  id: "post-1",
  characterId: "character-2",
  contentType: "feed",
  content: "직접 작성한 게시물",
  createdAt: new Date("2026-08-10T02:00:00.000Z"),
  postMedia: [],
};

describe("PostWorkspaceService", () => {
  const repository = {
    findDrafts: jest.fn(),
    findStandalonePosts: jest.fn(),
    findDraft: jest.fn(),
    findStandalonePost: jest.fn(),
  } as unknown as jest.Mocked<PostWorkspaceRepository>;
  const service = new PostWorkspaceService(repository);

  beforeEach(() => jest.clearAllMocks());

  it("merges lifecycle work by recent change and derives the current manual stage", async () => {
    repository.findDrafts.mockResolvedValue([draft] as never);
    repository.findStandalonePosts.mockResolvedValue([post] as never);

    const page = await service.list({ filter: "all", limit: 20 });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "draft-1",
        kind: "draft",
        currentStage: "evaluation",
        stageIndex: 4,
        operationalStatus: "needs_action",
        executionMode: "manual",
      }),
      expect.objectContaining({
        id: "post-1",
        kind: "post",
        currentStage: "memory",
        stageIndex: 8,
        operationalStatus: "completed",
      }),
    ]);
  });

  it("keeps draft-backed published posts out of the standalone post query contract", async () => {
    repository.findDrafts.mockResolvedValue([]);
    repository.findStandalonePosts.mockResolvedValue([]);

    await service.list({ filter: "published", limit: 20 });

    expect(repository.findStandalonePosts).toHaveBeenCalledWith(
      expect.objectContaining({ onlyStandalone: true }),
    );
  });

  it("filters the operations queue by the derived representative status", async () => {
    repository.findDrafts.mockResolvedValue([draft] as never);
    repository.findStandalonePosts.mockResolvedValue([post] as never);

    const page = await service.list({ filter: "needs_action", limit: 20 });

    expect(page.items.map((item) => item.id)).toEqual(["draft-1"]);
  });

  it("exposes a typed V3 stage and paused next action without reporting it as running", async () => {
    repository.findDraft.mockResolvedValue({
      ...draft,
      conceptJson: {
        pipelineVersion: "post-pipeline-v3",
        source: "manual",
        mode: "manual",
        pipeline: {
          stage: "image_plan",
          state: "blocked",
          imageCount: 2,
          reasonCodes: ["missing_identity_reference"],
        },
        postPlanning: {
          revision: 1,
          output: {
            status: "ready",
            intent: { premise: "비 오는 날의 산책" },
          },
        },
        imagePlanning: {
          revision: 1,
          output: { status: "blocked" },
        },
      },
      jobs: [],
    } as never);

    const item = await service.get("draft-1");

    expect(item).toEqual(
      expect.objectContaining({
        currentStage: "image_plan",
        stageIndex: 3,
        operationalStatus: "needs_action",
        pipelineV3: expect.objectContaining({
          state: "blocked",
          imageCount: 2,
          reasonCodes: ["missing_identity_reference"],
          nextAction: "레퍼런스나 이미지 기획을 보완하세요.",
        }),
      }),
    );
  });

  // 기획이 이상할 때 프롬프트를 의심하기 전에 Agent가 실제로 본 입력을 확인할
  // 수 있어야 한다. 필드명이 어긋나면 스냅숏이 조용히 빈 값이 된다.
  it("exposes the planning input the post planning agent actually received", async () => {
    repository.findDraft.mockResolvedValue({
      ...draft,
      conceptJson: {
        pipelineVersion: "post-pipeline-v3",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "image_plan", state: "pending", imageCount: 1 },
        postPlanning: {
          revision: 1,
          hash: "sha256:plan-1",
          input: {
            persona: {
              characterContext: [{ title: "identity", content: "필름 사진가" }],
              writingProfile: {
                contentStyle: [
                  { title: "content_style", content: "일상 기록" },
                ],
                voice: [{ title: "voice", content: "짧게 끊어 쓴다" }],
              },
              boundaries: [{ title: "boundaries", content: "" }],
              additionalContext: [],
            },
            memories: [{ type: "routine", content: "주말마다 현상한다" }],
            recentPosts: [
              {
                premise: "노을 산책",
                caption: "노을이 길었다",
                hashtags: ["필름"],
              },
            ],
          },
          output: { status: "ready", intent: { premise: "월요일 라인 체크" } },
        },
      },
      jobs: [],
    } as never);

    const item = await service.get("draft-1");

    expect(item.pipelineV3?.artifacts.postPlan?.planningInput).toEqual({
      // 내용이 빈 블록은 Agent에게 의미 있는 입력이 아니다.
      persona: [
        {
          group: "characterContext",
          title: "identity",
          content: "필름 사진가",
        },
        { group: "contentStyle", title: "content_style", content: "일상 기록" },
        { group: "voice", title: "voice", content: "짧게 끊어 쓴다" },
      ],
      memories: [{ type: "routine", content: "주말마다 현상한다" }],
      recentPosts: [
        { premise: "노을 산책", caption: "노을이 길었다", hashtags: ["필름"] },
      ],
    });
  });

  // 어느 프롬프트 버전이 산출물을 만들었는지는 프롬프트 실험 관측의 1차
  // 증거다. PromptSet은 같은 정보를 다른 키(commonPromptVersion)로 기록하므로
  // 그 키를 놓치면 ④에서만 조용히 사라진다.
  it("exposes the prompt version behind each artifact, across both key names", async () => {
    repository.findDraft.mockResolvedValue({
      ...draft,
      conceptJson: {
        pipelineVersion: "post-pipeline-v3",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "generation", state: "ready", imageCount: 1 },
        postPlanning: {
          revision: 1,
          promptVersion: "post-planner-v1",
          output: {},
        },
        imagePlanning: {
          revision: 2,
          promptVersion: "image-planner-v3",
          output: {},
        },
        promptBuild: {
          revision: 1,
          commonPromptVersion: "image-prompt-generator-v1",
          output: {},
        },
      },
      jobs: [],
    } as never);

    const item = await service.get("draft-1");

    expect(item.pipelineV3?.artifacts.postPlan?.promptVersion).toBe(
      "post-planner-v1",
    );
    expect(item.pipelineV3?.artifacts.imagePlan?.promptVersion).toBe(
      "image-planner-v3",
    );
    expect(item.pipelineV3?.artifacts.promptBuild?.promptVersion).toBe(
      "image-prompt-generator-v1",
    );
  });

  // V4 ⑥ 캡션: stale(컷 재생성으로 게시 이미지가 바뀜)과 matchesColumn(운영자
  // 수정 여부)은 서버가 계산해야 한다 — 두 쿼리를 클라이언트가 비교하면 폴링
  // 간격만큼 어긋난 값이 깜빡이고, "저장돼 있는데 화면이 못 읽는" 사고를 두 번
  // 겪었다(아키텍처 §19.2). 레일은 v4에서 검수 대신 캡션이다.
  it("exposes the V4 caption artifact with server-computed staleness", async () => {
    const captionOutput = {
      status: "ready",
      caption: "필라테스 끝나고 한 컷,, 오늘도 완룟",
      captionLanguages: ["ko"],
      hashtags: ["필라테스"],
    };
    const generationSet = generationSetHash([
      { sortOrder: 0, jobId: "job-old", mediaId: "media-old" },
    ]);
    repository.findDraft.mockResolvedValue({
      ...draft,
      status: "planned",
      caption: "운영자가 고친 캡션",
      conceptJson: {
        pipelineVersion: "post-pipeline-v4",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "publish", state: "pending", imageCount: 1 },
        postPlanning: { revision: 1, hash: "sha256:post", output: {} },
        captionBuild: {
          revision: 2,
          hash: "sha256:caption",
          contractVersion: "caption-set-v1",
          promptVersion: "caption-writer-v1",
          source: {
            postPlanningRevision: 1,
            postPlanningHash: "sha256:post",
            generationSetHash: generationSet,
          },
          input: { operatorNote: "이모지 빼고" },
          output: captionOutput,
        },
      },
      jobs: [
        // 컷 재생성으로 최신 잡이 바뀌었다 → 작성 기준과 다르므로 stale.
        {
          id: "job-new",
          sortOrder: 0,
          status: "completed",
          prompt: "p",
          updatedAt: new Date("2026-08-15T02:00:00.000Z"),
          outputs: [
            { selected: true, mediaId: "media-new", media: { url: "u" } },
          ],
        },
        {
          id: "job-old",
          sortOrder: 0,
          status: "completed",
          prompt: "p",
          updatedAt: new Date("2026-08-15T01:00:00.000Z"),
          outputs: [
            { selected: true, mediaId: "media-old", media: { url: "u" } },
          ],
        },
      ],
    } as never);

    const item = await service.get("draft-1");

    expect(item.currentStage).toBe("publish");
    expect(item.stageIndex).toBe(7);
    expect(item.pipelineV3?.version).toBe("post-pipeline-v4");
    expect(item.pipelineV3?.artifacts.captionBuild).toEqual({
      revision: 2,
      hash: "sha256:caption",
      contractVersion: "caption-set-v1",
      promptVersion: "caption-writer-v1",
      caption: "필라테스 끝나고 한 컷,, 오늘도 완룟",
      hashtags: ["필라테스"],
      captionLanguages: ["ko"],
      operatorNote: "이모지 빼고",
      stale: true,
      matchesColumn: false,
    });
  });

  it("maps the V4 caption stage and reports it as the operator's next action", async () => {
    repository.findDraft.mockResolvedValue({
      ...draft,
      status: "planned",
      conceptJson: {
        pipelineVersion: "post-pipeline-v4",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "caption", state: "pending", imageCount: 1 },
      },
      jobs: [],
    } as never);

    const item = await service.get("draft-1");

    expect(item.currentStage).toBe("caption");
    expect(item.stageIndex).toBe(6);
    expect(item.operationalStatus).toBe("needs_action");
    expect(item.statusDetail).toBe("캡션 생성 필요");
    expect(item.pipelineV3?.artifacts.captionBuild).toBeUndefined();
  });

  // 게시 트랜잭션(`selectedPublishedMemories`)은 selected이면서 현재 PostPlan
  // 해시에서 나온 후보만 저장한다. read model이 다른 기준을 쓰면 화면이 저장되지
  // 않은 기억을 저장됐다고 말하게 된다.
  it("marks memory candidates from a superseded post plan as stale", async () => {
    repository.findDraft.mockResolvedValue({
      ...draft,
      conceptJson: {
        pipelineVersion: "post-pipeline-v3",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "image_plan", state: "pending", imageCount: 1 },
        postPlanning: { revision: 2, hash: "sha256:plan-2", output: {} },
        memoryCandidates: [
          {
            type: "routine",
            content: "월요일마다 라인 체크",
            selected: true,
            sourcePostPlanHash: "sha256:plan-2",
          },
          {
            type: "fact",
            content: "이전 기획의 잔여 후보",
            selected: true,
            sourcePostPlanHash: "sha256:plan-1",
          },
        ],
      },
      jobs: [],
    } as never);

    const item = await service.get("draft-1");

    expect(item.pipelineV3?.memoryCandidates).toEqual([
      {
        type: "routine",
        content: "월요일마다 라인 체크",
        selected: true,
        stale: false,
      },
      {
        type: "fact",
        content: "이전 기획의 잔여 후보",
        selected: true,
        stale: true,
      },
    ]);
  });
});
