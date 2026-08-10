import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { DraftsPage } from "./DraftsPage";

type DraftCreateBody = {
  characterId: string;
  sceneHint?: string;
  mode?: string;
};

// Mantine SegmentedControl이 폰트 로딩을 기다린다.
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    ready: Promise.resolve(),
  },
});

const character = {
  id: "character-1",
  publicId: "soi",
  displayName: "한소이",
};

const createdDraft = {
  id: "draft-new",
  characterId: character.id,
  draftType: "post",
  contentType: "feed",
  caption: "",
  hashtags: [],
  status: "planned",
  attemptCount: 0,
  conceptJson: { source: "manual", mode: "manual", sceneHint: "비 오는 창가" },
  createdAt: "2026-08-03T01:00:00.000Z",
  updatedAt: "2026-08-03T01:00:00.000Z",
};

beforeEach(() => {
  server.use(
    http.get("/api/admin/v1/drafts/:draftId/evaluations", () =>
      HttpResponse.json({ items: [] }),
    ),
  );
});

describe("draft creation", () => {
  // 만든 초안의 단계 타임라인으로 바로 들어가지 못하면 방금 만든 초안을 다시
  // 찾아야 하고, 수동 모드에서는 다음 단계(기획 실행)를 시작할 수 없다.
  it("opens the created draft detail even when the current filter lists nothing", async () => {
    const requests: DraftCreateBody[] = [];
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      // 기본 필터는 "검수 필요"이고 새 초안은 planned라 목록에 잡히지 않는다.
      http.get("/api/admin/v1/drafts", () => HttpResponse.json({ items: [] })),
      http.get("/api/admin/v1/drafts/draft-new", () =>
        HttpResponse.json(createdDraft),
      ),
      http.post("/api/admin/v1/drafts", async ({ request }) => {
        requests.push((await request.json()) as DraftCreateBody);
        return HttpResponse.json(createdDraft, { status: 201 });
      }),
    );

    renderPage(<DraftsPage />, {
      path: "/drafts",
      routes: ["drafts", "drafts/:draftId"],
    });

    await userEvent.click(
      await screen.findByRole("combobox", { name: "캐릭터" }),
    );
    await userEvent.click(await screen.findByText("한소이"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "장면 힌트" }),
      "  비 오는 창가  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));

    await waitFor(() =>
      expect(requests).toEqual([
        {
          characterId: "character-1",
          sceneHint: "비 오는 창가",
          mode: "manual",
        },
      ]),
    );

    const detail = await screen.findByRole("heading", { name: "초안 상세" });
    const panel = detail.closest("section");
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText("비 오는 창가")).toBeInTheDocument();
    expect(
      within(panel!).getByRole("button", { name: "지금 기획 실행" }),
    ).toBeInTheDocument();
  });
});

describe("draft list identity", () => {
  // 운영자는 UUID가 아니라 캐릭터 이름으로 초안을 구분한다
  // (docs/04-design-rules.md:12 — raw ID는 기본 화면에 노출하지 않는다).
  it("resolves character names and shortens unknown ids", async () => {
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/drafts", () =>
        HttpResponse.json({
          items: [
            {
              ...createdDraft,
              id: "draft-known",
              caption: "아는 캐릭터",
              status: "needs_review",
            },
            {
              ...createdDraft,
              id: "draft-unknown",
              characterId: "character-deleted-999",
              caption: "모르는 캐릭터",
              status: "needs_review",
            },
          ],
        }),
      ),
    );

    renderPage(<DraftsPage />, {
      path: "/drafts",
      routes: ["drafts", "drafts/:draftId"],
    });

    const knownRow = (await screen.findByText("아는 캐릭터")).closest("tr");
    // 캐릭터 이름은 별도 조회라 목록보다 늦게 도착한다.
    expect(await within(knownRow!).findByText("한소이")).toBeInTheDocument();
    expect(
      within(knownRow!).queryByText("character-1"),
    ).not.toBeInTheDocument();

    // 목록에 없는 캐릭터는 앞 8자만 보이고 전체 ID는 title에 남는다.
    const unknownRow = screen.getByText("모르는 캐릭터").closest("tr");
    expect(within(unknownRow!).getByText("characte…")).toHaveAttribute(
      "title",
      "character-deleted-999",
    );
  });
});

describe("draft deep link", () => {
  // 운영자는 특정 초안을 두고 대화한다. 주소를 그대로 열면 그 초안이 열려야 하고,
  // 목록에서 연 상세는 주소에 남아야 새로고침·뒤로가기가 자리를 지킨다.
  it("opens the draft named in the url and records opened drafts in the url", async () => {
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/drafts", () =>
        HttpResponse.json({
          items: [
            {
              ...createdDraft,
              id: "draft-linked",
              caption: "링크로 연 초안",
              status: "needs_review",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/drafts/draft-linked", () =>
        HttpResponse.json({
          ...createdDraft,
          id: "draft-linked",
          caption: "링크로 연 초안",
          status: "needs_review",
        }),
      ),
    );

    renderPage(<DraftsPage />, {
      path: "/drafts/draft-linked",
      routes: ["drafts", "drafts/:draftId"],
    });

    expect(
      await screen.findByRole("heading", { name: "초안 상세" }),
    ).toBeInTheDocument();

    // 닫으면 목록 주소로 돌아가고 상세는 사라진다.
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "초안 상세" }),
      ).not.toBeInTheDocument(),
    );

    // 다시 열면 상세가 돌아온다 — 선택이 URL을 통해 오간다.
    await userEvent.click(screen.getByRole("button", { name: "상세" }));
    expect(
      await screen.findByRole("heading", { name: "초안 상세" }),
    ).toBeInTheDocument();
  });
});
