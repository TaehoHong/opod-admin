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

function registerHandlers(concept: Record<string, unknown>) {
  server.use(
    http.get("/api/admin/v1/post-work-items/:id", () =>
      HttpResponse.json(v3Item),
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

function renderStage(stage: string, concept: Record<string, unknown>) {
  registerHandlers(concept);
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
});
