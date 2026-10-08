import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostBriefCreatePage } from "./PostBriefCreatePage";

if (!window.HTMLElement.prototype.scrollIntoView)
  window.HTMLElement.prototype.scrollIntoView = () => {};

describe("post agent choice", () => {
  it("sends the chosen new agent and optional constraints when starting automatic production", async () => {
    let submitted: unknown;
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({
          items: [{ id: "character-1", displayName: "서린" }],
        }),
      ),
      http.get("/api/admin/v1/post-generation-agents/natural/config", () =>
        HttpResponse.json({ current: { revision: "saved" }, starters: {} }),
      ),
      http.post("/api/admin/v1/drafts", async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({ id: "draft-new" });
      }),
    );
    renderPage(<PostBriefCreatePage />, {
      path: "/posts/new?characterId=character-1",
    });
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "캐릭터" })).toHaveValue(
        "서린",
      ),
    );
    await screen.findByText("새 Agent는 사진 검수 후 자동 게시합니다.");
    await user.click(
      screen.getByRole("combobox", { name: "게시물 생성 Agent" }),
    );
    await user.click(
      await screen.findByText("새 Agent · 자연스러운 사진 자동 제작"),
    );
    await user.type(screen.getByLabelText("장면·주제 요청"), "컵을 닦는 순간");
    await user.click(screen.getByRole("button", { name: "자동 제작 시작" }));
    await waitFor(() =>
      expect(submitted).toEqual({
        characterId: "character-1",
        contentType: "feed",
        postGenerationAgent: "natural-v1",
        sceneHint: "컵을 닦는 순간",
      }),
    );
  });
});
