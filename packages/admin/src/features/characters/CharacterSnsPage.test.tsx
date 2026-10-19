import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppProviders } from "../../app/providers";
import { CharacterSnsDetailPage } from "./CharacterSnsDetailPage";
import { server } from "../../test/server";
import { CharacterSnsPage } from "./CharacterSnsPage";
import type { CharacterReferenceDirectoryItem } from "./api";

Element.prototype.scrollIntoView = () => {};
const endpoint = "/api/admin/v1/character-reference-directory";
const first: CharacterReferenceDirectoryItem = {
  id: "character-1",
  publicId: "minseo",
  displayName: "민서",
  referenceLinks: [
    {
      id: "9007199254740993",
      characterId: "character-1",
      url: "https://example.com/minseo",
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
    },
  ],
};
const second: CharacterReferenceDirectoryItem = {
  id: "character-2",
  publicId: "jinwoo",
  displayName: "진우",
  referenceLinks: [],
};
const page = Array.from({ length: 20 }, (_, i) => ({
  ...second,
  id: `person-${i}`,
  displayName: `인물 ${i}`,
  publicId: `person_${i}`,
}));

function renderSnsRoutes(path = "/sns-references") {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="sns-references" element={<CharacterSnsPage />} />
          <Route
            path="sns-references/:characterId"
            element={<CharacterSnsDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(() => {
  server.use(
    http.get("/api/admin/v1/characters/:id", ({ params }) =>
      HttpResponse.json(params.id === first.id ? first : second),
    ),
  );
});

describe("character SNS reference list and detail", () => {
  it("returns to the character list after a reference error and opens another character", async () => {
    server.use(
      http.get(endpoint, () => HttpResponse.json({ items: [first, second] })),
      http.get("/api/admin/v1/characters/:id/reference-links", ({ params }) =>
        params.id === first.id
          ? HttpResponse.json({ message: "참조 조회 오류" }, { status: 503 })
          : HttpResponse.json([]),
      ),
    );
    renderSnsRoutes();
    await userEvent.click(await screen.findByRole("row", { name: /민서/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "참조 조회 오류",
    );
    expect(
      screen.queryByText("등록된 참조 링크가 없습니다."),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "목록으로" }));
    await userEvent.click(await screen.findByRole("row", { name: /진우/ }));
    expect(
      await screen.findByText("등록된 참조 링크가 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens a separate detail page from a row and displays all of that character's references", async () => {
    const references = [
      first.referenceLinks[0],
      { ...first.referenceLinks[0], id: "2", url: "https://example.org/other" },
    ];
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          items: [{ ...first, referenceLinks: references }, second],
        }),
      ),
      http.get("/api/admin/v1/characters/:id/reference-links", ({ params }) =>
        HttpResponse.json(params.id === first.id ? references : []),
      ),
    );
    renderSnsRoutes();
    expect(
      await screen.findByRole("link", { name: "민서의 SNS 레퍼런스 보기" }),
    ).toHaveAttribute("href", "/sns-references/character-1");
    await userEvent.click(screen.getByRole("cell", { name: "2개" }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "민서의 SNS 레퍼런스",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const detail = within(
      await screen.findByRole("region", { name: "연결된 링크" }),
    );
    expect(
      await detail.findByRole("link", {
        name: "https://example.com/minseo 새 탭에서 열기",
      }),
    ).toHaveAttribute("target", "_blank");
    expect(
      detail.getByRole("link", {
        name: "https://example.org/other 새 탭에서 열기",
      }),
    ).toBeVisible();
    expect(detail.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "목록으로" }));
    const other = await screen.findByRole("link", {
      name: "진우의 SNS 레퍼런스 보기",
    });
    other.focus();
    await userEvent.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "진우의 SNS 레퍼런스",
      }),
    ).toBeVisible();
    expect(
      await screen.findByText("등록된 참조 링크가 없습니다."),
    ).toBeVisible();
  });

  it("saves new references under the detail character and updates the list count on return", async () => {
    const created: unknown[] = [];
    let references = [...first.referenceLinks];
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          items: [{ ...first, referenceLinks: references }, second],
        }),
      ),
      http.get("/api/admin/v1/characters/:id/reference-links", () =>
        HttpResponse.json(references),
      ),
      http.post(
        "/api/admin/v1/characters/:id/reference-links",
        async ({ params, request }) => {
          const body = (await request.json()) as { url: string };
          created.push({ characterId: params.id, ...body });
          const reference = {
            ...first.referenceLinks[0],
            id: "2",
            url: body.url,
          };
          references = [...references, reference];
          return HttpResponse.json(reference, { status: 201 });
        },
      ),
    );
    renderSnsRoutes();
    await userEvent.click(await screen.findByRole("row", { name: /민서/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "링크 추가" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "참조 URL" }),
      "https://example.org/new",
    );
    expect(screen.getByRole("button", { name: "목록으로" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("link", {
      name: "https://example.org/new 새 탭에서 열기",
    });
    expect(created).toEqual([
      { characterId: "character-1", url: "https://example.org/new" },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "목록으로" })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: "목록으로" }));
    expect(await screen.findByRole("row", { name: /민서/ })).toHaveTextContent(
      "2개",
    );
  });

  it("replaces 20-character pages and preserves the filtered page and previous cursor after visiting detail", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(endpoint, ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        return HttpResponse.json(
          params.get("cursor")
            ? { items: [first] }
            : { items: page, nextCursor: "next-page" },
        );
      }),
      http.get("/api/admin/v1/characters/:id/reference-links", () =>
        HttpResponse.json(first.referenceLinks),
      ),
    );
    renderSnsRoutes("/sns-references?search=민&registration=registered");
    const table = within(
      await screen.findByRole("table", { name: "캐릭터별 SNS 레퍼런스" }),
    );
    expect(table.getAllByRole("link")).toHaveLength(20);
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    const link = await screen.findByRole("link", {
      name: "민서의 SNS 레퍼런스 보기",
    });
    expect(
      screen.queryByRole("link", { name: "인물 0의 SNS 레퍼런스 보기" }),
    ).not.toBeInTheDocument();
    await userEvent.click(link);
    await screen.findByRole("heading", {
      level: 1,
      name: "민서의 SNS 레퍼런스",
    });
    await userEvent.click(screen.getByRole("button", { name: "목록으로" }));
    await screen.findByRole("link", { name: "민서의 SNS 레퍼런스 보기" });
    expect(screen.getByRole("textbox", { name: "캐릭터 검색" })).toHaveValue(
      "민",
    );
    expect(screen.getByRole("combobox", { name: "등록 상태" })).toHaveValue(
      "등록",
    );
    expect(requests.at(-1)?.get("cursor")).toBe("next-page");
    await userEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByRole("link", { name: "인물 0의 SNS 레퍼런스 보기" });
    expect(requests.at(-1)?.has("cursor")).toBe(false);
  });

  it("keeps search and registration filters available for empty results and resets the old cursor", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(endpoint, ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        return HttpResponse.json({
          items:
            params.get("search") === "민서" &&
            params.get("registration") !== "missing"
              ? [first]
              : [],
        });
      }),
    );
    renderSnsRoutes("/sns-references?cursor=old-page");
    await screen.findByText("조건에 맞는 캐릭터가 없습니다.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "캐릭터 검색" }),
      "민서",
    );
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByRole("row", { name: /민서/ });
    expect(requests.at(-1)?.get("search")).toBe("민서");
    expect(requests.at(-1)?.has("cursor")).toBe(false);
    expect(requests.at(-1)?.get("limit")).toBe("20");
    await userEvent.click(screen.getByRole("combobox", { name: "등록 상태" }));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await screen.findByText("조건에 맞는 캐릭터가 없습니다.");
    expect(requests.at(-1)?.get("registration")).toBe("missing");
    expect(screen.getByRole("textbox", { name: "캐릭터 검색" })).toHaveValue(
      "민서",
    );
  });

  it("opens a character's detail directly and allows cancelling an edit before returning to the list", async () => {
    server.use(
      http.get(endpoint, () => HttpResponse.json({ items: [first] })),
      http.get("/api/admin/v1/characters/character-1/reference-links", () =>
        HttpResponse.json(first.referenceLinks),
      ),
    );
    renderSnsRoutes("/sns-references/character-1");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "민서의 SNS 레퍼런스",
      }),
    ).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "수정" }));
    expect(screen.getByRole("textbox", { name: "참조 URL" })).toHaveValue(
      first.referenceLinks[0].url,
    );
    expect(screen.getByRole("button", { name: "목록으로" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "목록으로" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "목록으로" }));
    expect(
      await screen.findByRole("table", { name: "캐릭터별 SNS 레퍼런스" }),
    ).toBeVisible();
  });
});
