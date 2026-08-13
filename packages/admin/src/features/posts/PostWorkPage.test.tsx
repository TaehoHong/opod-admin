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
      HttpResponse.json({ items: [] }),
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
  } = {},
) {
  registerHandlers(concept, overrides.item ?? v3Item, overrides.draft ?? {});
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
    renderStage("brief", {
      source: "manual",
      mode: "manual",
      sceneHint: "노을 지는 골목",
    });

    expect(await screen.findByText("노을 지는 골목")).toBeInTheDocument();
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
});
