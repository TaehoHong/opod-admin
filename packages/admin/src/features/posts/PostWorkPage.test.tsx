import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostWorkPage } from "./PostWorkPage";

const v3Item = {
  id: "draft-1",
  kind: "draft",
  draftId: "draft-1",
  characterId: "character-1",
  contentType: "feed",
  caption: "월요일 라인 체크",
  currentStage: "post_plan",
  stageIndex: 2,
  operationalStatus: "needs_action",
  statusDetail: "게시글 기획 실행 필요",
  executionMode: "manual",
  source: "manual",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T01:15:00.000Z",
  pipelineV3: {
    version: "post-pipeline-v3",
    stage: "image_plan",
    state: "pending",
    imageCount: 1,
    reasonCodes: [],
    nextAction: "현재 단계를 실행하세요.",
    artifacts: {
      postPlan: {
        revision: 1,
        status: "ready",
        hash: "sha256:dc1916fe",
        contractVersion: "post-plan-v1",
        premise: "월요일에 붓기가 정리된 상태를 기록한다.",
        primaryPurpose: "주간 라인 체크",
        caption: "월요일 라인 체크,,\n이번 주도 편하게",
        hashtags: ["라인체크", "애슬레저룩"],
        captionLanguages: ["ko"],
        memoryCandidates: [],
      },
    },
  },
};

function registerHandlers(
  concept: Record<string, unknown>,
  item: Record<string, unknown> = v3Item,
  draft: Record<string, unknown> = {},
  evaluations: Record<string, unknown>[] = [],
) {
  server.use(
    http.get("/api/admin/v1/post-work-items/:id", () =>
      HttpResponse.json(item),
    ),
    http.get("/api/admin/v1/drafts/:id", () =>
      HttpResponse.json({
        id: "draft-1",
        characterId: "character-1",
        draftType: "post",
        contentType: "feed",
        caption: "월요일 라인 체크",
        hashtags: [],
        status: "generating",
        attemptCount: 1,
        conceptJson: concept,
        shots: [],
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T01:15:00.000Z",
        ...draft,
      }),
    ),
    http.get("/api/admin/v1/drafts/:id/evaluations", () =>
      HttpResponse.json({ items: evaluations }),
    ),
    http.get("/api/admin/v1/characters", () =>
      HttpResponse.json({
        items: [{ id: "character-1", publicId: "seorin", displayName: "서린" }],
      }),
    ),
  );
}

function renderStage(
  stage: string,
  concept: Record<string, unknown>,
  overrides: {
    item?: Record<string, unknown>;
    draft?: Record<string, unknown>;
    evaluations?: Record<string, unknown>[];
  } = {},
) {
  registerHandlers(
    concept,
    overrides.item ?? v3Item,
    overrides.draft ?? {},
    overrides.evaluations ?? [],
  );
  renderPage(<PostWorkPage workId="draft-1" stage={stage} />, {
    path: `/posts/draft-1/${stage}`,
    routes: ["posts/:workId/:stage"],
  });
}

describe("post work stage screens", () => {
  // V3는 운영자 요청을 operatorRequest에 저장한다. V2 필드만 읽으면 운영자가
  // 입력한 요청이 화면에서 사라지고, 이후 단계에서 대조할 기준이 없어진다.
  it("shows the V3 operator request on the brief stage", async () => {
    renderStage("brief", {
      pipelineVersion: "post-pipeline-v3",
      source: "manual",
      mode: "manual",
      operatorRequest: "비 오는 날 창가에서 필름 카메라를 닦는 장면",
    });

    expect(
      await screen.findByText("비 오는 날 창가에서 필름 카메라를 닦는 장면"),
    ).toBeInTheDocument();
  });

  it("still shows the legacy scene hint on the brief stage", async () => {
    renderStage(
      "brief",
      { source: "manual", mode: "manual", sceneHint: "노을 지는 골목" },
      // V2 초안에는 pipelineV3가 없다.
      { item: { ...v3Item, pipelineV3: undefined } },
    );

    expect(await screen.findByText("노을 지는 골목")).toBeInTheDocument();
  });

  // 백엔드가 V2 초안의 operatorRequest 수정을 거부한다. 입력란을 띄우면 운영자가
  // 고칠 수 있다고 믿고 저장을 눌러 400을 받는다.
  it("offers the operator request editor on V3 only", async () => {
    renderStage(
      "brief",
      { source: "manual", mode: "manual", sceneHint: "노을 지는 골목" },
      { item: { ...v3Item, pipelineV3: undefined } },
    );

    expect(await screen.findByText("노을 지는 골목")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "요청 저장" }),
    ).not.toBeInTheDocument();
  });

  it("lets the operator rewrite the request while a stage is waiting", async () => {
    renderStage(
      "brief",
      {
        pipelineVersion: "post-pipeline-v3",
        source: "manual",
        mode: "manual",
        operatorRequest: "비 오는 날 창가",
      },
      { draft: { status: "planned" } },
    );

    expect(
      await screen.findByRole("button", { name: "요청 저장" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("비 오는 날 창가")).toBeInTheDocument();
  });

  // 실행 중에 바꾸면 저장된 요청과 실제 사용된 입력이 어긋난다. 백엔드도
  // 거부하므로 화면이 먼저 이유를 말한다.
  it("explains why the request is locked while the agent runs", async () => {
    renderStage(
      "brief",
      {
        pipelineVersion: "post-pipeline-v3",
        source: "manual",
        mode: "manual",
        operatorRequest: "비 오는 날 창가",
      },
      { draft: { status: "generating" } },
    );

    expect(await screen.findByText("비 오는 날 창가")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "요청 저장" }),
    ).not.toBeInTheDocument();
  });

  it("shows the post plan caption, hashtags and memory verdict", async () => {
    renderStage("post_plan", {
      pipelineVersion: "post-pipeline-v3",
      source: "manual",
      mode: "manual",
      operatorRequest: null,
    });

    // 단계 레일에도 같은 문구가 있으므로 단계 본문으로 범위를 좁힌다.
    const body = within(await screen.findByRole("region"));
    expect(body.getByText(/월요일 라인 체크,,/)).toBeInTheDocument();
    expect(body.getByText("#라인체크")).toBeInTheDocument();
    expect(body.getByText("#애슬레저룩")).toBeInTheDocument();
    // 빈 후보 배열은 "표시할 게 없음"이 아니라 "새 기억을 남기지 않는다"는 판정이다.
    expect(body.getByText("없음")).toBeInTheDocument();
    // 게시글 기획은 이미 지나간 단계이므로 완료로 표시되어야 한다.
    expect(body.getByText("완료")).toBeInTheDocument();
  });

  // 게시 트랜잭션(`selectedPublishedMemories`)은 selected이면서 현재 PostPlan
  // 해시에서 나온 후보만 저장한다. 화면이 그 규칙과 어긋나면 운영자는 세계관에
  // 없는 사실을 있다고 믿고 다음 기획을 판단한다.
  it("marks memory candidates by the same rule the publish path uses", async () => {
    renderStage(
      "memory",
      { pipelineVersion: "post-pipeline-v3", source: "manual", mode: "manual" },
      {
        draft: { status: "published" },
        item: {
          ...v3Item,
          currentStage: "memory",
          stageIndex: 8,
          pipelineV3: {
            ...v3Item.pipelineV3,
            stage: "memory",
            state: "ready",
            memoryCandidates: [
              {
                type: "routine",
                content: "월요일마다 라인 체크를 한다",
                selected: true,
                stale: false,
              },
              {
                type: "fact",
                content: "새 필름 카메라를 샀다",
                selected: false,
                stale: false,
              },
              {
                type: "event",
                content: "이전 기획의 잔여 후보",
                selected: true,
                stale: true,
              },
            ],
          },
        },
      },
    );

    const body = within(await screen.findByRole("region"));
    expect(body.getByText("저장됨")).toBeInTheDocument();
    expect(body.getByText("제외됨")).toBeInTheDocument();
    // selected여도 기획을 다시 돌렸으면 저장되지 않는다.
    expect(body.getByText("무효")).toBeInTheDocument();
    expect(body.getAllByText("저장됨")).toHaveLength(1);
  });

  // V3는 지적이 없으면 issuesJson이 []이고 suggestionsJson은 항상 null이다.
  // 그 두 컬럼만 덤프하면 "원문 보기"가 빈 껍데기를 보여준다 — Agent가 실제로
  // 무엇을 근거로 통과시켰는지 확인할 길이 사라진다.
  it("shows the V3 agent output as the raw evaluation, not the empty legacy columns", async () => {
    renderStage(
      "post_plan",
      { pipelineVersion: "post-pipeline-v3", source: "manual", mode: "manual" },
      {
        evaluations: [
          {
            id: "evaluation-1",
            draftId: "draft-1",
            kind: "plan",
            attempt: 1,
            status: "completed",
            rubricVersion: "v1",
            contentLanguage: "ko",
            evaluatorName: "post-evaluator-v1",
            overallScore: 5,
            scoresJson: {
              _meta: {
                evaluatorVersion: "post-evaluator-v1",
                targetHash: "sha256:3226b8b",
              },
              result: {
                status: "evaluated_ready",
                verdict: "pass",
                scores: { voice_fit: 5 },
                issues: [],
              },
            },
            // V3가 실제로 저장하는 모양 — 지적이 없으면 둘 다 비어 있다.
            issuesJson: [],
            suggestionsJson: null,
            createdAt: "2026-08-13T01:15:00.000Z",
            completedAt: "2026-08-13T01:15:04.000Z",
          },
        ],
      },
    );

    // Spoiler는 jsdom에서 높이를 0으로 보고 접지 않으므로 본문이 바로 붙는다.
    const raw = await screen.findByText(/evaluated_ready/);
    expect(raw).toHaveTextContent("sha256:3226b8b");
    expect(raw).toHaveTextContent("post-evaluator-v1");
    // 예전에는 이 자리에 빈 껍데기만 나왔다.
    expect(raw.textContent).not.toBe(
      JSON.stringify({ issues: [], suggestions: null }, null, 2),
    );
  });

  it("shows the planning input snapshot the agent actually received", async () => {
    renderStage(
      "brief",
      { pipelineVersion: "post-pipeline-v3", source: "manual", mode: "manual" },
      {
        item: {
          ...v3Item,
          pipelineV3: {
            ...v3Item.pipelineV3,
            artifacts: {
              postPlan: {
                ...v3Item.pipelineV3.artifacts.postPlan,
                planningInput: {
                  persona: [
                    {
                      group: "voice",
                      title: "말투",
                      content: "짧게 끊어 쓰고 이모지를 쓰지 않는다",
                    },
                  ],
                  memories: [
                    { type: "routine", content: "주말마다 필름을 현상한다" },
                  ],
                  recentPosts: [],
                },
              },
            },
          },
        },
      },
    );

    // Spoiler도 region을 만들므로 여기서는 문구로 직접 찾는다.
    expect(
      await screen.findByText(
        "페르소나 블록 1개 · 메모리 1건 · 최근 게시물 0건",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("짧게 끊어 쓰고 이모지를 쓰지 않는다"),
    ).toBeInTheDocument();
  });

  // V4(검수 없음): 레일 ⑥이 검수가 아니라 캡션이다. v3 초안(배포 전 것)은 그대로
  // 검수 레일이어야 한다 — 두 초안이 같은 화면에서 다른 레일을 보인다.
  it("shows the caption stage instead of review on the V4 rail only", async () => {
    renderStage(
      "caption",
      {
        pipelineVersion: "post-pipeline-v4",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "caption", state: "pending" },
      },
      {
        item: {
          ...v3Item,
          currentStage: "caption",
          stageIndex: 6,
          statusDetail: "캡션 생성 필요",
          pipelineV3: {
            ...v3Item.pipelineV3,
            version: "post-pipeline-v4",
            stage: "caption",
            artifacts: {},
          },
        },
        draft: { status: "planned", caption: "" },
      },
    );

    // 버전 배지도 실제 값에서 뽑아야 한다 — 문구에 박아두면 V4 초안이 V3로
    // 보이고, 운영자가 "V3로 돌고 있나?"를 의심하게 된다(실제로 났던 오해).
    expect(await screen.findByText("Agent V4")).toBeInTheDocument();
    const rail = within(
      await screen.findByRole("navigation", { name: "게시물 생성 단계" }),
    );
    expect(rail.getByText("⑥ 캡션")).toBeInTheDocument();
    expect(rail.queryByText(/검수/)).not.toBeInTheDocument();
    // 컷이 없으니 실행 조건은 알려주되, 산출물 없음도 함께 말한다.
    expect(
      screen.getByRole("button", { name: "캡션 생성" }),
    ).toBeInTheDocument();
  });

  // ⑥ 캡션 화면: Agent 원본(참고)과 게시 캡션(컬럼, 편집)이 함께 있고 어느 쪽이
  // 게시되는지 라벨로 갈린다. stale이면 계보 자리에 경고가 뜨되 "무효"라고
  // 말하지 않는다 — 게시는 막히지 않는다.
  it("shows the caption artifact next to the editable publish caption", async () => {
    renderStage(
      "caption",
      {
        pipelineVersion: "post-pipeline-v4",
        source: "manual",
        mode: "manual",
        pipeline: { stage: "publish", state: "pending" },
      },
      {
        item: {
          ...v3Item,
          caption: "필라테스 끝나고 한 컷,, 오늘도 완룟",
          currentStage: "publish",
          stageIndex: 7,
          pipelineV3: {
            ...v3Item.pipelineV3,
            version: "post-pipeline-v4",
            stage: "publish",
            artifacts: {
              captionBuild: {
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
              },
            },
          },
        },
        draft: {
          status: "planned",
          caption: "필라테스 끝나고 한 컷 — 오늘도 완료",
          hashtags: ["필라테스"],
        },
      },
    );

    expect(await screen.findByText("Agent 원본")).toBeInTheDocument();
    expect(screen.getByText("게시 캡션")).toBeInTheDocument();
    expect(screen.getByText("운영자 수정본")).toBeInTheDocument();
    expect(screen.getByText(/프롬프트 caption-writer-v1/)).toBeInTheDocument();
    expect(
      screen.getByText("이전 이미지 기준으로 작성됐습니다"),
    ).toBeInTheDocument();
    expect(screen.queryByText("무효")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "캡션 다시 생성" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "게시 캡션 저장" }),
    ).toBeInTheDocument();
    // 편집 폼은 게시 컬럼 값으로 채워진다(원본이 아니라).
    expect(
      screen.getByDisplayValue("필라테스 끝나고 한 컷 — 오늘도 완료"),
    ).toBeInTheDocument();
  });

  // 계약 v2 PostPlan에는 캡션이 없다 — ② 카드는 전제를 리드로 보이고 캡션 줄이
  // 없어야 한다. v1 artifact(위 테스트)는 계속 캡션을 보인다.
  it("renders a v2 post plan without a caption line", async () => {
    renderStage(
      "post_plan",
      {
        pipelineVersion: "post-pipeline-v4",
        source: "manual",
        mode: "manual",
      },
      {
        item: {
          ...v3Item,
          caption: "",
          pipelineV3: {
            ...v3Item.pipelineV3,
            version: "post-pipeline-v4",
            artifacts: {
              postPlan: {
                revision: 1,
                status: "ready",
                hash: "sha256:v2",
                contractVersion: "post-plan-v2",
                promptVersion: "post-planner-v2",
                premise: "필라테스 다녀와 현관 거울 앞에 섰다.",
                primaryPurpose: "운동 후 기록",
                memoryCandidates: [],
              },
            },
          },
        },
      },
    );

    const body = within(await screen.findByRole("region"));
    expect(
      body.getByText("필라테스 다녀와 현관 거울 앞에 섰다."),
    ).toBeInTheDocument();
    expect(body.queryByText("캡션")).not.toBeInTheDocument();
    // 제목은 캡션이 없으니 전제(가제)로.
    expect(
      screen.getByRole("heading", {
        name: /필라테스 다녀와 현관 거울 앞에 섰다\. \(가제\)/,
      }),
    ).toBeInTheDocument();
  });
});
