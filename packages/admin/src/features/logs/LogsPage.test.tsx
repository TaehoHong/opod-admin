import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { LogsPage } from "./LogsPage";

const log = {
  id: "9007199254740993",
  characterId: "character-1",
  actionType: "GENERATION_JOB_FAILED",
  targetTable: "generation_jobs",
  targetId: "job-1",
  reason: "공급자 응답 시간 초과\n이미지 생성 결과를 확인하세요.",
  createdAt: "2026-10-02T01:02:03.000Z",
};
const routes = ["/logs", "/logs/:logId"];

describe("action log details", () => {
  beforeEach(() => {
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({
          items: [{ id: log.characterId, displayName: "테스트 캐릭터" }],
        }),
      ),
    );
  });
  it("opens the selected row with the keyboard and restores the character filter", async () => {
    server.use(
      http.get("/api/admin/v1/character-action-logs", () =>
        HttpResponse.json({ items: [log] }),
      ),
      http.get("/api/admin/v1/character-action-logs/:id", () =>
        HttpResponse.json(log),
      ),
    );
    renderPage(<LogsPage />, { path: "/logs?characterId=character-1", routes });
    const row = (await screen.findByText(log.actionType)).closest("tr")!;
    const link = within(row).getByRole("link", { name: "상세" });
    link.focus();
    await userEvent.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: "액션 로그 상세" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/공급자 응답 시간 초과/)).toHaveTextContent(
      "이미지 생성 결과를 확인하세요.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "목록으로" }));
    expect(
      await screen.findByRole("textbox", { name: "캐릭터 ID" }),
    ).toHaveValue("character-1");
  });

  it("fetches a detail directly even when it is absent from the list", async () => {
    server.use(
      http.get("/api/admin/v1/character-action-logs/:id", ({ params }) => {
        expect(params.id).toBe(log.id);
        return HttpResponse.json(log);
      }),
    );
    renderPage(<LogsPage />, { path: `/logs/${log.id}`, routes });
    expect(await screen.findByText(log.actionType)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "대상 · 식별 정보" }),
    );
    expect(screen.getByText(log.id)).toBeInTheDocument();
    expect(screen.getByText(log.targetId)).toBeInTheDocument();
  });

  it("shows a missing-log error with a usable back link", async () => {
    server.use(
      http.get("/api/admin/v1/character-action-logs/:id", () =>
        HttpResponse.json(
          { message: "액션 로그를 찾을 수 없습니다." },
          { status: 404 },
        ),
      ),
    );
    renderPage(<LogsPage />, { path: "/logs/999", routes });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "액션 로그를 찾을 수 없습니다.",
    );
    expect(screen.getByRole("link", { name: "목록으로" })).toHaveAttribute(
      "href",
      "/logs",
    );
  });
});
