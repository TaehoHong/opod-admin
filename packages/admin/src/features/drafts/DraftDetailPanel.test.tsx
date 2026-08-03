import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { DraftDetailPanel } from "./DraftDetailPanel";

Object.defineProperty(document, "fonts", {
  configurable: true,
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    ready: Promise.resolve(),
  },
});

describe("draft generation trace", () => {
  it("warns about a generation mismatch without disabling approval", async () => {
    server.use(
      http.get("/api/admin/v1/drafts/draft-1", () =>
        HttpResponse.json({
          id: "draft-1",
          characterId: "character-1",
          draftType: "post",
          contentType: "feed",
          caption: "노을 산책",
          hashtags: ["필름사진"],
          status: "needs_review",
          attemptCount: 1,
          conceptJson: { mode: "manual", plan: { shots: [{}] } },
          shots: [
            {
              sortOrder: 0,
              jobId: "job-1",
              status: "completed",
              prompt: "a quiet sunset walk",
              provider: "fal:new-edit-model",
              generationTrace: {
                captureSetup: "벤치 위 고정 카메라와 셀프타이머",
                characterVisible: true,
                planned: {
                  route: "edit",
                  targetModelId: "old-edit-model",
                  references: [],
                },
                execution: {
                  route: "edit",
                  provider: "fal:new-edit-model",
                  references: [],
                },
                matchesPlan: false,
              },
              outputs: [
                {
                  mediaId: "media-1",
                  url: "https://cdn.local/generated.png",
                  candidateIndex: 0,
                  selected: true,
                  filterPreset: "none",
                },
              ],
            },
          ],
          createdAt: "2026-07-31T01:00:00.000Z",
          updatedAt: "2026-07-31T01:05:00.000Z",
        }),
      ),
    );

    render(
      <AppProviders>
        <DraftDetailPanel draftId="draft-1" />
      </AppProviders>,
    );

    expect(
      await screen.findByText("기획과 실제 생성 조건이 다릅니다"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "승인" })).not.toBeDisabled();
  });
});

function draftWithCandidate(filterPreset: string) {
  return {
    id: "draft-1",
    characterId: "character-1",
    draftType: "post",
    contentType: "feed",
    caption: "노을 산책",
    hashtags: [],
    status: "needs_review",
    attemptCount: 1,
    conceptJson: { mode: "manual", plan: { shots: [{}] } },
    shots: [
      {
        sortOrder: 0,
        jobId: "job-1",
        status: "completed",
        prompt: "a quiet sunset walk",
        outputs: [
          {
            mediaId: "media-1",
            url: "https://cdn.local/candidate-1.png",
            candidateIndex: 0,
            selected: false,
            filterPreset,
          },
        ],
      },
    ],
    createdAt: "2026-07-31T01:00:00.000Z",
    updatedAt: "2026-07-31T01:05:00.000Z",
  };
}

describe("draft candidate zoom", () => {
  // 썸네일만으로는 채택 여부를 판단할 수 없다. 후보를 클릭하면 원본을 크게 보되
  // 게시 이미지 선택은 그대로여야 한다 — 확대와 선택은 다른 결정이다.
  it("opens a candidate image in a lightbox without changing the selection", async () => {
    const selectRequests: string[] = [];
    server.use(
      http.get("/api/admin/v1/drafts/draft-1", () =>
        HttpResponse.json(draftWithCandidate("none")),
      ),
      http.post("/api/admin/v1/drafts/draft-1/jobs/job-1/select", () => {
        selectRequests.push("select");
        return HttpResponse.json({});
      }),
    );

    render(
      <AppProviders>
        <DraftDetailPanel draftId="draft-1" />
      </AppProviders>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "후보 1 크게 보기" }),
    );

    const lightbox = await screen.findByRole("dialog");
    expect(
      within(lightbox).getByRole("img", { name: "후보 1" }),
    ).toHaveAttribute("src", "https://cdn.local/candidate-1.png");
    expect(selectRequests).toEqual([]);
    expect(
      screen.getByRole("button", { name: "이 이미지 선택" }),
    ).toBeInTheDocument();
  });

  // 마감 필터가 무엇을 바꿨는지는 원본과 겹쳐 봐야 판단할 수 있다. 마감이 걸린
  // 후보는 확대가 곧 비교다.
  it("opens a finished candidate as an original/finish comparison", async () => {
    server.use(
      http.get("/api/admin/v1/drafts/draft-1", () =>
        HttpResponse.json(draftWithCandidate("film")),
      ),
    );

    render(
      <AppProviders>
        <DraftDetailPanel draftId="draft-1" />
      </AppProviders>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "후보 1 크게 보기" }),
    );

    const lightbox = await screen.findByRole("dialog");
    expect(
      within(lightbox).getByRole("img", { name: "후보 1" }),
    ).toHaveAttribute("src", "https://cdn.local/candidate-1.png");
    expect(
      within(lightbox).getByRole("img", { name: "후보 1 마감 · 필름" }),
    ).toHaveAttribute(
      "src",
      "/api/admin/v1/media/media-1/film-finish?preset=film",
    );
    expect(
      within(lightbox).getByRole("slider", {
        name: "원본/마감 · 필름 비교 슬라이더",
      }),
    ).toHaveValue("50");
  });
});
