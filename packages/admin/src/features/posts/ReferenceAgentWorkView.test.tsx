import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostWorkPage } from "./PostWorkPage";
import { fetchReferenceSource } from "./reference-agent-view";
import { ReferenceAgentWorkView } from "./ReferenceAgentWorkView";
import type { Draft } from "../drafts/api";
import type { PostWorkItem } from "./api";
const item: PostWorkItem = {
  id: "r1",
  kind: "draft",
  draftId: "r1",
  characterId: "c1",
  postGenerationAgent: "reference-v1",
  contentType: "feed",
  caption: "",
  currentStage: "reference_select",
  stageIndex: 1,
  operationalStatus: "needs_action",
  statusDetail: "선택 대기",
  executionMode: "manual",
  source: "manual",
  createdAt: "",
  updatedAt: "",
};
const draft: Draft = {
  id: "r1",
  characterId: "c1",
  draftType: "post",
  contentType: "feed",
  caption: "저장 캡션",
  hashtags: [],
  status: "needs_review",
  attemptCount: 0,
  createdAt: "",
  updatedAt: "",
  conceptJson: {
    postGenerationAgent: "reference-v1",
    referenceSelection: {
      revision: 1,
      shots: [1, 2].map((i) => ({
        shotId: `s${i}`,
        sortOrder: i,
        mediaId: `m${i}`,
        influencerId: "i1",
        postId: "p1",
        slideIndex: i,
        mediaKey: `key${i}`,
        sha256: `hash${i}`,
        sourceCaption: `원문 ${i}`,
        reason: `이유 ${i}`,
        url: `https://example.com/${i}.jpg`,
      })),
    },
  },
};
describe("reference detail", () => {
  beforeEach(() =>
    server.use(
      http.get("/api/admin/v1/llm-logs", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [{ id: "c1", displayName: "서린" }] }),
      ),
    ),
  );
  it("renders reference route before legacy stage validation and executes only the current stage", async () => {
    server.use(
      http.get("/api/admin/v1/post-work-items/:id", () =>
        HttpResponse.json(item),
      ),
      http.get("/api/admin/v1/drafts/:id", () =>
        HttpResponse.json({ ...draft, status: "planned" }),
      ),
    );
    renderPage(<PostWorkPage workId="r1" stage="reference_select" />);
    expect(
      await screen.findByRole("heading", { name: "원본 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "원본 선택 실행" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("게시글 기획")).not.toBeInTheDocument();
  });
  it("switches saved shot content and leaves missing execution records empty", async () => {
    const user = userEvent.setup();
    renderPage(
      <ReferenceAgentWorkView
        item={item}
        draft={draft}
        stage="reference_select"
      />,
    );
    await user.click(screen.getByRole("button", { name: "사진 2" }));
    await user.click(screen.getByText("선택 이유"));
    await user.click(screen.getByText("원본 캡션 보기"));
    expect(screen.getByText("원문 2")).toBeVisible();
    expect(screen.getByText("이유 2")).toBeVisible();
    expect(
      await screen.findByText("실행 기록이 없습니다."),
    ).toBeInTheDocument();
  });
  it("keeps caption edits when a polling response updates the saved draft", async () => {
    const user = userEvent.setup();
    function PollingView() {
      const [saved, setSaved] = useState(draft);
      return (
        <>
          <button onClick={() => setSaved({ ...draft, caption: "서버 최신" })}>
            폴링
          </button>
          <ReferenceAgentWorkView item={item} draft={saved} stage="caption" />
        </>
      );
    }
    renderPage(<PollingView />);
    await user.clear(screen.getByRole("textbox", { name: "캡션" }));
    await user.type(screen.getByRole("textbox", { name: "캡션" }), "작업 중");
    await user.click(screen.getByRole("button", { name: "폴링" }));
    expect(screen.getByRole("textbox", { name: "캡션" })).toHaveValue(
      "작업 중",
    );
  });
  it("shows genuine empty state when no artifacts or images exist", () => {
    renderPage(
      <ReferenceAgentWorkView
        item={item}
        draft={{
          ...draft,
          conceptJson: { postGenerationAgent: "reference-v1" },
        }}
        stage="generation"
      />,
    );
    expect(
      screen.getByText("저장된 레퍼런스 선택 결과가 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("이미지 생성 기록이 없습니다."),
    ).toBeInTheDocument();
  });
  it("uses the artifact producer id and exposes failure without querying unrelated logs", async () => {
    let requestedId = "";
    server.use(
      http.get("/api/admin/v1/llm-logs/:id", ({ params }) => {
        requestedId = String(params.id);
        return HttpResponse.json({ message: "missing" }, { status: 404 });
      }),
    );
    renderPage(
      <ReferenceAgentWorkView
        item={item}
        draft={{
          ...draft,
          conceptJson: {
            ...draft.conceptJson,
            captionBuild: {
              revision: 1,
              producerLogId: "accepted-caption-log",
              output: { caption: "저장된 모델 캡션" },
            },
          },
        }}
        stage="caption"
      />,
    );
    expect(
      await screen.findByText("실행 기록을 불러오지 못했습니다."),
    ).toBeInTheDocument();
    expect(requestedId).toBe("accepted-caption-log");
  });
  it("never displays a live source whose media hash differs from the saved selection", async () => {
    server.use(
      http.get("/api/admin/v1/influencer-media", () =>
        HttpResponse.json({
          items: [
            {
              id: "m1",
              sha256: "changed",
              imageUrl: "https://example.com/changed.jpg",
            },
          ],
        }),
      ),
    );
    expect(
      await fetchReferenceSource({
        shotId: "s1",
        sortOrder: 1,
        mediaId: "m1",
        influencerId: "i1",
        postId: "p1",
        slideIndex: 1,
        mediaKey: "k1",
        sha256: "saved",
        reason: "",
        sourceCaption: null,
      }),
    ).toBeNull();
  });
  it("opens a local publish preview with the current caption without publishing", async () => {
    const user = userEvent.setup();
    renderPage(
      <ReferenceAgentWorkView item={item} draft={draft} stage="caption" />,
    );
    await user.clear(screen.getByRole("textbox", { name: "캡션" }));
    await user.type(
      screen.getByRole("textbox", { name: "캡션" }),
      "미리볼 캡션",
    );
    await user.click(screen.getByRole("button", { name: "게시 미리보기" }));
    expect(
      await screen.findByRole("dialog", { name: "게시 미리보기" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("미리볼 캡션", { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "게시하기" }),
    ).toBeInTheDocument();
  });
  it("posts the current stage and revision once instead of navigating forward", async () => {
    let body: unknown;
    server.use(
      http.post("/api/admin/v1/drafts/r1/plan", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...draft, status: "planned" });
      }),
    );
    renderPage(
      <ReferenceAgentWorkView
        item={item}
        draft={{ ...draft, status: "planned", updatedAt: "revision-1" }}
        stage="reference_select"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "원본 선택 실행" }),
    );
    await waitFor(() =>
      expect(body).toEqual({
        expectedStage: "reference_select",
        expectedRevision: "revision-1",
      }),
    );
  });
  it("offers only navigation while viewing a completed earlier stage", () => {
    renderPage(
      <ReferenceAgentWorkView
        item={{ ...item, currentStage: "image_prompt" }}
        draft={{ ...draft, status: "planned" }}
        stage="reference_select"
      />,
    );
    expect(
      screen.getByRole("button", { name: "현재 단계로" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "원본 선택 실행" }),
    ).not.toBeInTheDocument();
  });
  it("retries only the selected failed job and refreshes without creating a replacement", async () => {
    const requests: string[] = [];
    server.use(
      http.get("/api/admin/v1/llm-logs", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.post("/api/admin/v1/generation/jobs/failed-job/retry", () => {
        requests.push("retry");
        return HttpResponse.json({});
      }),
      http.get("/api/admin/v1/drafts/r1", () => {
        requests.push("refresh");
        return HttpResponse.json(draft);
      }),
    );
    renderPage(
      <ReferenceAgentWorkView
        item={{ ...item, currentStage: "generation" }}
        draft={{
          ...draft,
          status: "failed",
          shots: [
            {
              sortOrder: 1,
              jobId: "failed-job",
              status: "failed",
              prompt: "saved",
              outputs: [],
            },
          ],
        }}
        stage="generation"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "실패한 사진 재시도" }),
    );
    await waitFor(() => expect(requests).toEqual(["retry", "refresh"]));
  });
  it.each([
    {
      label: "게시하기",
      scheduledAt: undefined,
      expected: ["approve", "publish"],
    },
    {
      label: "예약 게시",
      scheduledAt: "2026-10-20T00:00:00Z",
      expected: ["approve"],
    },
  ])(
    "requires explicit confirmation for $label and respects the saved schedule",
    async ({ label, scheduledAt, expected }) => {
      const requests: string[] = [];
      server.use(
        http.post("/api/admin/v1/drafts/r1/approve", () => {
          requests.push("approve");
          return HttpResponse.json({ ...draft, status: "approved" });
        }),
        http.post("/api/admin/v1/drafts/r1/publish", () => {
          requests.push("publish");
          return HttpResponse.json({ ...draft, status: "published" });
        }),
      );
      renderPage(
        <ReferenceAgentWorkView
          item={{ ...item, currentStage: "caption" }}
          draft={{
            ...draft,
            scheduledAt,
            shots: [
              {
                sortOrder: 1,
                jobId: "ready-job",
                status: "succeeded",
                prompt: "saved",
                outputs: [
                  {
                    mediaId: "generated",
                    url: "https://example.com/generated.jpg",
                    candidateIndex: 0,
                    selected: true,
                    filterPreset: null,
                  },
                ],
              },
            ],
          }}
          stage="caption"
        />,
      );
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(requests).toEqual([]);
      await userEvent.click(
        await screen.findByRole("button", { name: "게시 확인" }),
      );
      await waitFor(() => expect(requests).toEqual(expected));
    },
  );
  it.each([
    { stage: "reference_select" as const, label: "원본 다시 선택" },
    { stage: "generation" as const, label: "이미지 다시 생성" },
  ])(
    "confirms $label with the saved revision and cancellation sends no request",
    async ({ stage, label }) => {
      const bodies: unknown[] = [];
      server.use(
        http.post(
          "/api/admin/v1/drafts/r1/reference/restart",
          async ({ request }) => {
            bodies.push(await request.json());
            return HttpResponse.json({ ...draft, status: "planned" });
          },
        ),
      );
      renderPage(
        <ReferenceAgentWorkView
          item={{ ...item, currentStage: stage }}
          draft={{
            ...draft,
            updatedAt: "saved-revision",
            shots: [
              {
                sortOrder: 1,
                jobId: "completed-job",
                status: "completed",
                prompt: "saved",
                outputs: [],
              },
            ],
          }}
          stage={stage}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: label }));
      await userEvent.click(
        await screen.findByRole("button", { name: "취소" }),
      );
      expect(bodies).toEqual([]);
      await userEvent.click(screen.getByRole("button", { name: label }));
      await userEvent.click(
        await screen.findByRole("button", { name: "다시 시작" }),
      );
      await waitFor(() =>
        expect(bodies).toEqual([
          { target: stage, expectedRevision: "saved-revision" },
        ]),
      );
    },
  );
  it("offers successful regeneration only for a complete current job set and blocks source reset during work", () => {
    const screenView = renderPage(
      <ReferenceAgentWorkView
        item={{ ...item, currentStage: "generation" }}
        draft={{
          ...draft,
          status: "generating",
          shots: [
            {
              sortOrder: 1,
              jobId: "running-job",
              status: "running",
              prompt: "saved",
              outputs: [],
            },
          ],
        }}
        stage="generation"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "이미지 다시 생성" }),
    ).not.toBeInTheDocument();
    screenView.unmount();
    renderPage(
      <ReferenceAgentWorkView
        item={item}
        draft={{ ...draft, status: "generating" }}
        stage="reference_select"
      />,
    );
    expect(
      screen.getByRole("button", { name: "원본 다시 선택" }),
    ).toBeDisabled();
  });
  it("finds failed-stage raw logs using only the draft and exact stage type when no artifact producer exists", async () => {
    let query = "";
    server.use(
      http.get("/api/admin/v1/llm-logs", ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ items: [] });
      }),
    );
    renderPage(
      <ReferenceAgentWorkView
        item={item}
        draft={{
          ...draft,
          conceptJson: { postGenerationAgent: "reference-v1" },
        }}
        stage="image_prompt"
      />,
    );
    await waitFor(() => expect(query).toContain("requestId=r1"));
    expect(query).toContain("type=admin.reference.post.image.prompt");
    expect(query).not.toContain("generationJobId");
  });
  it("advances completed current generation jobs through bookkeeping while the draft still says generating", async () => {
    const requests: string[] = [];
    server.use(
      http.post("/api/admin/v1/drafts/r1/aggregate", () => {
        requests.push("aggregate");
        return HttpResponse.json({ ...draft, status: "planned" });
      }),
      http.post("/api/admin/v1/drafts/r1/plan", () => {
        requests.push("plan");
        return HttpResponse.json(draft);
      }),
    );
    renderPage(
      <ReferenceAgentWorkView
        item={{ ...item, currentStage: "generation" }}
        draft={{
          ...draft,
          status: "generating",
          conceptJson: {
            ...draft.conceptJson,
            generationBuild: { jobIds: ["current-job"] },
          } as Draft["conceptJson"],
          shots: [
            {
              sortOrder: 1,
              jobId: "current-job",
              status: "completed",
              prompt: "saved",
              outputs: [],
            },
            {
              sortOrder: 2,
              jobId: "old-job",
              status: "failed",
              prompt: "old",
              outputs: [],
            },
          ],
        }}
        stage="generation"
      />,
    );
    expect(
      screen.getByRole("button", { name: "생성 결과 확인" }),
    ).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "생성 결과 확인" }),
    );
    await waitFor(() => expect(requests).toEqual(["aggregate"]));
  });
  it("keeps generation advancement disabled until every accepted current job has completed", () => {
    renderPage(
      <ReferenceAgentWorkView
        item={{ ...item, currentStage: "generation" }}
        draft={{
          ...draft,
          status: "generating",
          conceptJson: {
            ...draft.conceptJson,
            generationBuild: { jobIds: ["completed-job", "pending-job"] },
          } as Draft["conceptJson"],
          shots: [
            {
              sortOrder: 1,
              jobId: "completed-job",
              status: "completed",
              prompt: "saved",
              outputs: [],
            },
            {
              sortOrder: 2,
              jobId: "pending-job",
              status: "running",
              prompt: "saved",
              outputs: [],
            },
          ],
        }}
        stage="generation"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "생성 결과 확인" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "이미지 생성 실행" }),
    ).toBeDisabled();
  });
  it("runs only the selected accepted queued job and refreshes the draft", async () => {
    const requests: unknown[] = [];
    server.use(
      http.post("/api/admin/v1/generation/worker/run", async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ jobId: "queued-current" });
      }),
      http.get("/api/admin/v1/drafts/r1", () => {
        requests.push("refresh");
        return HttpResponse.json(draft);
      }),
    );
    renderPage(
      <ReferenceAgentWorkView
        item={{ ...item, currentStage: "generation" }}
        draft={{
          ...draft,
          status: "generating",
          conceptJson: {
            ...draft.conceptJson,
            generationBuild: { jobIds: ["queued-current"] },
          } as Draft["conceptJson"],
          shots: [
            {
              sortOrder: 1,
              jobId: "queued-old",
              status: "queued",
              prompt: "old",
              outputs: [],
            },
            {
              sortOrder: 1,
              jobId: "queued-current",
              status: "queued",
              prompt: "saved",
              outputs: [],
            },
          ],
        }}
        stage="generation"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "이 컷 생성 실행" }),
    );
    await waitFor(() =>
      expect(requests).toEqual([{ jobId: "queued-current" }, "refresh"]),
    );
  });
});
