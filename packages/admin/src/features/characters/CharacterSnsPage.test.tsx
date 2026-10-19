import { screen, within } from "@testing-library/react";
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
const page = Array.from({ length: 20 }, (_, i) => ({
  ...first,
  id: `person-${i}`,
  publicId: `person_${i}`,
  displayName: `인물 ${i}`,
  referenceLinks: [],
}));

describe("SNS reference directory", () => {
  it("keeps multiple links compact and exposes every additional link on demand", async () => {
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          items: [
            {
              ...first,
              referenceLinks: [
                ...first.referenceLinks,
                {
                  ...first.referenceLinks[0],
                  id: "2",
                  url: "https://example.org/other",
                },
              ],
            },
          ],
        }),
      ),
    );
    renderPage(<CharacterSnsPage />);
    await screen.findByText("2개 등록");
    expect(
      screen.queryByRole("link", {
        name: "민서 참조 SNS https://example.org/other 새 탭에서 열기",
      }),
    ).not.toBeVisible();
    await userEvent.click(screen.getByText("추가 링크 1개 보기"));
    const additional = await screen.findByRole("link", {
      name: "민서 참조 SNS https://example.org/other 새 탭에서 열기",
    });
    expect(additional).toBeVisible();
    expect(additional).toHaveAttribute("href", "https://example.org/other");
  });

  it("replaces a 20-character page on next and previous instead of accumulating rows", async () => {
    server.use(
      http.get(endpoint, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("cursor") === "next-page"
            ? { items: [first] }
            : { items: page, nextCursor: "next-page" },
        ),
      ),
    );
    renderPage(<CharacterSnsPage />);
    const table = await screen.findByRole("table", {
      name: "캐릭터별 SNS 레퍼런스",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("민서");
    expect(screen.queryByText("인물 0")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    const link = screen.getByRole("link", {
      name: "민서 참조 SNS https://example.com/minseo 새 탭에서 열기",
    });
    expect(link).toHaveAttribute("href", "https://example.com/minseo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("link", { name: "민서 링크 관리" }),
    ).toHaveAttribute("href", "/characters/character-1?section=profile");
    await userEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByText("인물 0");
    expect(screen.queryByText("민서")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      21,
    );
  });

  it("sends search and registration filters to the server, clears the old cursor and keeps filters usable for empty results", async () => {
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
    renderPage(<CharacterSnsPage />, {
      path: "/sns-references?cursor=old-page",
    });
    await screen.findByText("조건에 맞는 캐릭터가 없습니다.");
    await userEvent.type(
      screen.getByRole("textbox", { name: "캐릭터 검색" }),
      "민서",
    );
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByText("민서");
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
    expect(screen.getByRole("combobox", { name: "등록 상태" })).toHaveValue(
      "미등록",
    );
  });

  it("distinguishes a failed request from empty data and recovers with the same filters", async () => {
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({ message: "일시적인 조회 오류" }, { status: 503 }),
      ),
    );
    renderPage(<CharacterSnsPage />, { path: "/sns-references?search=minseo" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "일시적인 조회 오류",
    );
    expect(
      screen.queryByText("조건에 맞는 캐릭터가 없습니다."),
    ).not.toBeInTheDocument();
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({ items: [{ ...first, referenceLinks: [] }] }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("등록된 링크 없음");
    expect(screen.getByRole("textbox", { name: "캐릭터 검색" })).toHaveValue(
      "minseo",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
