import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { CharacterSnsPage } from "./CharacterSnsPage";
import type { CharacterListItem, CharacterReferenceLink } from "./api";

const first: CharacterListItem = {
  id: "character-1",
  publicId: "minseo",
  displayName: "민서",
  bio: "",
  interests: [],
  status: "active",
  postCount: 0,
  followerCount: 0,
  createdAt: "2026-10-19T00:00:00.000Z",
};
const second: CharacterListItem = {
  ...first,
  id: "character-2",
  publicId: "jinwoo",
  displayName: "진우",
};
const third: CharacterListItem = {
  ...first,
  id: "character-3",
  publicId: "soyeon",
  displayName: "소연",
};
const reference: CharacterReferenceLink = {
  id: "9007199254740993",
  characterId: first.id,
  url: "https://example.com/minseo",
  createdAt: first.createdAt,
  updatedAt: first.createdAt,
};
const endpoint = "/api/admin/v1/characters/:id/reference-links";

describe("character SNS overview", () => {
  it("groups multiple references by character, shows unregistered characters and loads later pages", async () => {
    server.use(
      http.get("/api/admin/v1/characters", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has("cursor")
            ? { items: [third] }
            : { items: [first, second], nextCursor: "next-page" },
        ),
      ),
      http.get(endpoint, ({ params }) =>
        HttpResponse.json(
          params.id === first.id
            ? [
                reference,
                { ...reference, id: "2", url: "https://example.org/other" },
              ]
            : params.id === third.id
              ? [
                  {
                    ...reference,
                    characterId: third.id,
                    url: "https://example.net/soyeon",
                  },
                ]
              : [],
        ),
      ),
    );
    renderPage(<CharacterSnsPage />);

    const firstCard = within(
      await screen.findByRole("region", { name: "민서 SNS" }),
    );
    const link = await firstCard.findByRole("link", {
      name: "민서 참조 SNS https://example.com/minseo 새 탭에서 열기",
    });
    expect(link).toHaveAttribute("href", "https://example.com/minseo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(firstCard.getByText("2개 등록")).toBeInTheDocument();
    expect(
      firstCard.getByText("https://example.org/other"),
    ).toBeInTheDocument();
    expect(
      firstCard.getByRole("link", { name: "민서 링크 관리" }),
    ).toHaveAttribute("href", "/characters/character-1?section=profile");

    const secondCard = within(screen.getByRole("region", { name: "진우 SNS" }));
    expect(await secondCard.findByText("미등록")).toBeInTheDocument();
    expect(
      secondCard.queryByRole("link", { name: /새 탭에서 열기/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    const thirdCard = within(
      await screen.findByRole("region", { name: "소연 SNS" }),
    );
    expect(
      await thirdCard.findByText("https://example.net/soyeon"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "더 보기" }),
    ).not.toBeInTheDocument();
    expect(
      firstCard.getByText("https://example.com/minseo"),
    ).toBeInTheDocument();
  });

  it("keeps other characters visible on a link failure and retries without reporting it as unregistered", async () => {
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [first, second] }),
      ),
      http.get(endpoint, ({ params }) =>
        params.id === first.id
          ? HttpResponse.json(
              { message: "일시적인 조회 오류" },
              { status: 503 },
            )
          : HttpResponse.json([]),
      ),
    );
    renderPage(<CharacterSnsPage />);
    const firstCard = within(
      await screen.findByRole("region", { name: "민서 SNS" }),
    );
    expect(await firstCard.findByRole("alert")).toHaveTextContent(
      "일시적인 조회 오류",
    );
    expect(firstCard.queryByText("미등록")).not.toBeInTheDocument();
    expect(
      await within(screen.getByRole("region", { name: "진우 SNS" })).findByText(
        "미등록",
      ),
    ).toBeInTheDocument();

    server.use(http.get(endpoint, () => HttpResponse.json([reference])));
    await userEvent.click(firstCard.getByRole("button", { name: "다시 시도" }));
    expect(
      await firstCard.findByText("https://example.com/minseo"),
    ).toBeInTheDocument();
    expect(firstCard.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a retry when the character list fails and shows an empty state after recovery", async () => {
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ message: "목록 조회 오류" }, { status: 503 }),
      ),
    );
    renderPage(<CharacterSnsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "목록 조회 오류",
    );
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [] }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "캐릭터 목록 다시 시도" }),
    );
    expect(
      await screen.findByText("등록된 캐릭터가 없습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
