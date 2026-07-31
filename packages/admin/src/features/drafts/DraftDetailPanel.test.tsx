import { render, screen } from "@testing-library/react";
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
