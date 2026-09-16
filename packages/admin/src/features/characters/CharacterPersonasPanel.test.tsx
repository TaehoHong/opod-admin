import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { CharacterPersonasPanel } from "./CharacterPersonasPanel";

const endpoint = "/api/admin/v1/characters/:id/personas/:personaId/structure";

function show(title = "social_style") {
  render(
    <AppProviders>
      <CharacterPersonasPanel
        characterId="character-1"
        personas={[
          {
            id: "persona-1",
            characterId: "character-1",
            title,
            content: "테스트 설정",
            schemaVersion: 1,
            sortOrder: 0,
            createdAt: "2026-09-12T00:00:00Z",
            updatedAt: "2026-09-12T00:00:00Z",
          },
        ]}
      />
    </AppProviders>,
  );
}

describe("persona classification display", () => {
  it.each([
    ["social_style", "대인 반응 (social_style)"],
    ["appearance", "외형 (appearance)"],
    ["goals", "목표 (goals)"],
  ])(
    "shows the saved %s category without a blank selection",
    async (title, label) => {
      server.use(
        http.get(endpoint, () => HttpResponse.json({ fragments: [] })),
      );
      show(title);
      expect(
        screen.getAllByRole("combobox", { name: "내용 분류" })[1],
      ).toHaveValue(label);
      await screen.findByText(/저장된 처리 역할·주입 방식이 없습니다/);
    },
  );

  it("shows each stored fragment policy instead of inferring it from the title", async () => {
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          schemaVersion: 2,
          fragments: [
            {
              id: "f1",
              ordinal: 0,
              kind: "motivation",
              injection: "always",
            },
            {
              id: "f2",
              ordinal: 1,
              kind: "boundary",
              injection: "retrieved",
            },
          ],
        }),
      ),
    );
    show();
    expect(await screen.findByText(/페르소나 스키마 v2/)).toBeInTheDocument();
    expect(
      screen.getByText(/처리 역할: 욕구·동기 \(motivation\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/항상 주입 \(always\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/처리 역할: 행동 경계 \(boundary\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/관련 문맥에서 선별 주입 \(retrieved\)/),
    ).toBeInTheDocument();
  });

  it("distinguishes lookup failure from missing policy and lets the operator retry", async () => {
    server.use(
      http.get(endpoint, () => new HttpResponse(null, { status: 503 })),
    );
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "채팅 처리 정보를 불러오지 못했습니다",
    );
    expect(
      screen.queryByText(/저장된 처리 역할·주입 방식이 없습니다/),
    ).not.toBeInTheDocument();
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          fragments: [
            { id: "f1", ordinal: 0, kind: "behavior", injection: "always" },
          ],
        }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "처리 정보 다시 조회" }),
    );
    expect(await screen.findByText(/항상 주입 \(always\)/)).toBeInTheDocument();
  });

  it("keeps custom titles visible and follows direct title edits", async () => {
    server.use(http.get(endpoint, () => HttpResponse.json({ fragments: [] })));
    show("custom_notes");
    const title = screen.getByLabelText("페르소나 제목");
    expect(
      screen.getAllByRole("combobox", { name: "내용 분류" })[1],
    ).toHaveValue("직접 입력 (custom_notes)");
    await userEvent.clear(title);
    await userEvent.type(title, "appearance");
    expect(
      screen.getAllByRole("combobox", { name: "내용 분류" })[1],
    ).toHaveValue("외형 (appearance)");
  });
});
