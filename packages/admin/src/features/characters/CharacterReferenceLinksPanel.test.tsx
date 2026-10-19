import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { CharacterReferenceLinksPanel } from "./CharacterReferenceLinksPanel";
import type { CharacterReferenceLink } from "./api";

const endpoint = "/api/admin/v1/characters/:characterId/influencers";
const initial: CharacterReferenceLink = {
  id: "9007199254740993",
  characterId: "character-1",
  url: "https://www.instagram.com/example/",
};

describe("character reference link editor", () => {
  it("adds, opens, edits and deletes links while preserving BIGINT IDs", async () => {
    let stored: CharacterReferenceLink[] = [];
    server.use(
      http.get(endpoint, () => HttpResponse.json(stored)),
      http.post(endpoint, async ({ request }) => {
        const { url } = (await request.json()) as { url: string };
        stored = [{ ...initial, url }];
        return HttpResponse.json(stored[0], { status: 201 });
      }),
      http.patch(`${endpoint}/:id`, async ({ params, request }) => {
        expect(params.id).toBe("9007199254740993");
        const { url } = (await request.json()) as { url: string };
        stored = [{ ...initial, url }];
        return HttpResponse.json(stored[0]);
      }),
      http.delete(`${endpoint}/:id`, ({ params }) => {
        expect(params.id).toBe("9007199254740993");
        stored = [];
        return HttpResponse.json({ id: params.id });
      }),
    );
    render(
      <AppProviders>
        <MemoryRouter>
          <CharacterReferenceLinksPanel characterId="character-1" />
        </MemoryRouter>
      </AppProviders>,
    );
    await screen.findByText("등록된 참조 링크가 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "링크 추가" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "참조 URL" }),
      initial.url,
    );
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    const link = await screen.findByRole("link", {
      name: `${initial.url} 새 탭에서 열기`,
    });
    expect(link).toHaveAttribute("href", initial.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "수집 미디어" })).toHaveAttribute(
      "href",
      "/sns-references?account=9007199254740993",
    );
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    const input = screen.getByRole("textbox", { name: "참조 URL" });
    await userEvent.clear(input);
    await userEvent.type(input, "https://www.instagram.com/updated/");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("link", {
      name: "https://www.instagram.com/updated/ 새 탭에서 열기",
    });
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await screen.findByText("참조 링크를 삭제했습니다.");
    await waitFor(() =>
      expect(screen.queryByRole("link")).not.toBeInTheDocument(),
    );
  });

  it("preserves an edited URL after a server error and rejects unsafe URL schemes", async () => {
    server.use(
      http.get(endpoint, () => HttpResponse.json([initial])),
      http.patch(`${endpoint}/:id`, () =>
        HttpResponse.json({ message: "저장 실패" }, { status: 500 }),
      ),
    );
    render(
      <AppProviders>
        <MemoryRouter>
          <CharacterReferenceLinksPanel characterId="character-1" />
        </MemoryRouter>
      </AppProviders>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "수정" }));
    const input = screen.getByRole("textbox", { name: "참조 URL" });
    await userEvent.clear(input);
    await userEvent.type(input, "https://example.org/keep");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장 실패");
    expect(input).toHaveValue("https://example.org/keep");
    await userEvent.clear(input);
    await userEvent.type(input, "javascript:alert(1)");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("HTTP 또는 HTTPS 주소를 입력해 주세요.");
  });
});
