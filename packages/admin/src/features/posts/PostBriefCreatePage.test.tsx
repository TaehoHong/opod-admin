import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostBriefCreatePage } from "./PostBriefCreatePage";

if (!window.HTMLElement.prototype.scrollIntoView)
  window.HTMLElement.prototype.scrollIntoView = () => {};

beforeEach(() =>
  server.use(
    http.get("/api/admin/v1/post-generation-agents/reference/config", () =>
      HttpResponse.json({
        current: {
          revision: null,
          selection: { batchSize: 12, maxAttempts: 1 },
        },
      }),
    ),
  ),
);
describe("post agent choice", () => {
  it.each([
    ["reference-v1", "manual", "레퍼런스 Agent", "수동 · 단계별 실행"],
    ["reference-v1", "auto", "레퍼런스 Agent", "자동 · 연속 진행"],
    [
      "natural-v1",
      "manual",
      "새 Agent · 자연스러운 사진",
      "수동 · 단계별 실행",
    ],
    ["natural-v1", "auto", "새 Agent · 자연스러운 사진", "자동 · 연속 진행"],
  ])(
    "creates %s in %s mode without coupling the selections",
    async (agent, mode, agentLabel, modeLabel) => {
      let submitted: unknown;
      server.use(
        http.get("/api/admin/v1/post-generation-agents/reference/config", () =>
          HttpResponse.json({
            current: {
              revision: "saved",
              selection: { batchSize: 12, maxAttempts: 1 },
              stages: { reference_select: {}, image_prompt: {}, caption: {} },
              generation: { revision: 1 },
            },
          }),
        ),
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
      await screen.findByText("Agent와 진행 방식을 각각 선택하세요.");
      expect(screen.queryByText("기존 Agent")).toBeNull();
      expect(
        screen.getByRole("combobox", { name: "게시물 생성 Agent" }),
      ).toHaveValue("새 Agent · 자연스러운 사진");
      await user.click(
        screen.getByRole("combobox", { name: "게시물 생성 Agent" }),
      );
      await user.click(await screen.findByText(agentLabel, { exact: true }));
      await user.click(screen.getByRole("combobox", { name: "진행 방식" }));
      await user.click(await screen.findByText(modeLabel, { exact: true }));
      await user.type(
        screen.getByLabelText("장면·주제 요청"),
        "컵을 닦는 순간",
      );
      await user.click(
        screen.getByRole("button", {
          name: mode === "auto" ? "자동 제작 시작" : "저장하고 기획으로",
        }),
      );
      await waitFor(() =>
        expect(submitted).toEqual({
          characterId: "character-1",
          contentType: "feed",
          postGenerationAgent: agent,
          mode,
          sceneHint: "컵을 닦는 순간",
        }),
      );
    },
  );
});
