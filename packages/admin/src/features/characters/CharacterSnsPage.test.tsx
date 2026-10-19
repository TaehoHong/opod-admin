import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderPage } from "../../test/renderPage";
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

describe("character to many SNS references", () => {
  it("keeps parent selection available when one character's reference list fails", async () => {
    server.use(
      http.get(endpoint, () => HttpResponse.json({ items: [first, second] })),
      http.get("/api/admin/v1/characters/:id/reference-links", ({ params }) =>
        params.id === first.id
          ? HttpResponse.json({ message: "참조 조회 오류" }, { status: 503 })
          : HttpResponse.json([]),
      ),
    );
    renderPage(<CharacterSnsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "민서 선택" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "참조 조회 오류",
    );
    expect(
      screen.queryByText("등록된 참조 링크가 없습니다."),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "진우 선택" }));
    expect(
      await screen.findByText("등록된 참조 링크가 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows every link for the selected character and changes the child list when another character is selected", async () => {
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
    renderPage(<CharacterSnsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "민서 선택" }),
    );
    const detail = within(
      await screen.findByRole("region", { name: "민서의 SNS 레퍼런스" }),
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
    expect(screen.getByRole("button", { name: "민서 선택" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "진우 선택" }));
    const other = within(
      await screen.findByRole("region", { name: "진우의 SNS 레퍼런스" }),
    );
    expect(
      await other.findByText("등록된 참조 링크가 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: "https://example.com/minseo 새 탭에서 열기",
      }),
    ).not.toBeInTheDocument();
    expect(other.getByRole("button", { name: "링크 추가" })).toBeEnabled();
  });

  it("saves a new child under its selected parent and protects the draft while switching or paging", async () => {
    const created: unknown[] = [];
    let references = [...first.referenceLinks];
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({ items: [first, second], nextCursor: "next-page" }),
      ),
      http.get("/api/admin/v1/characters/:id/reference-links", ({ params }) =>
        HttpResponse.json(params.id === first.id ? references : []),
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
    renderPage(<CharacterSnsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "민서 선택" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "링크 추가" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "참조 URL" }),
      "https://example.org/new",
    );
    expect(screen.getByRole("button", { name: "진우 선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "캐릭터 검색" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "참조 URL" })).toHaveValue(
      "https://example.org/new",
    );
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("link", {
      name: "https://example.org/new 새 탭에서 열기",
    });
    expect(created).toEqual([
      { characterId: "character-1", url: "https://example.org/new" },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "진우 선택" })).toBeEnabled(),
    );
  });

  it("replaces the 20-character selector page instead of accumulating parent items", async () => {
    server.use(
      http.get(endpoint, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("cursor")
            ? { items: [first] }
            : { items: page, nextCursor: "next-page" },
        ),
      ),
      http.get("/api/admin/v1/characters/:id/reference-links", () =>
        HttpResponse.json([]),
      ),
    );
    renderPage(<CharacterSnsPage />);
    const navigation = within(
      await screen.findByRole("navigation", { name: "캐릭터 선택" }),
    );
    expect(navigation.getAllByRole("button")).toHaveLength(20);
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("button", { name: "민서 선택" });
    expect(
      screen.queryByRole("button", { name: "인물 0 선택" }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "캐릭터 선택" }),
      ).getAllByRole("button"),
    ).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByRole("button", { name: "인물 0 선택" });
    expect(
      within(
        screen.getByRole("navigation", { name: "캐릭터 선택" }),
      ).getAllByRole("button"),
    ).toHaveLength(20);
  });

  it("keeps server-side search and registration filters available for empty results and resets the old cursor", async () => {
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
      http.get("/api/admin/v1/characters/:id/reference-links", () =>
        HttpResponse.json(first.referenceLinks),
      ),
    );
    renderPage(<CharacterSnsPage />, {
      path: "/sns-references?cursor=old-page",
    });
    await screen.findByText("조건에 맞는 캐릭터가 없습니다.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "캐릭터 검색" }),
      "민서",
    );
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByRole("button", { name: "민서 선택" });
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

  it("opens a selected parent from a deep link even when it is outside the current selector page", async () => {
    server.use(
      http.get(endpoint, () => HttpResponse.json({ items: page })),
      http.get("/api/admin/v1/characters/character-1", () =>
        HttpResponse.json(first),
      ),
      http.get("/api/admin/v1/characters/character-1/reference-links", () =>
        HttpResponse.json(first.referenceLinks),
      ),
    );
    renderPage(<CharacterSnsPage />, {
      path: "/sns-references?character=character-1",
    });
    const detail = within(
      await screen.findByRole("region", { name: "민서의 SNS 레퍼런스" }),
    );
    expect(
      await detail.findByRole("link", {
        name: "https://example.com/minseo 새 탭에서 열기",
      }),
    ).toBeVisible();
  });
});
