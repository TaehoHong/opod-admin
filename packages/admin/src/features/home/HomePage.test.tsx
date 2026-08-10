import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { renderPage } from "../../test/renderPage";
import { HomePage } from "./HomePage";

const EMPTY_PAGE = { items: [] };

// 홈은 열 개 가까운 목록 API를 동시에 부른다. 그중 하나가 죽어도 나머지 숫자는
// 남아야 한다 — 예전에는 Promise.all 하나가 reject되며 화면이 통째로 사라졌다.
function stubDesk(overrides: Record<string, () => Response> = {}) {
  const paths = [
    "/api/admin/v1/characters",
    "/api/admin/v1/posts",
    "/api/admin/v1/users",
    "/api/admin/v1/generation/jobs",
    "/api/admin/v1/character-action-logs",
    "/api/admin/v1/post-work-items",
    "/api/admin/v1/media",
    "/api/admin/v1/moderation/reports",
    "/api/admin/v1/payments/reconciliation",
  ];
  server.use(
    ...paths.map((path) =>
      http.get(path, overrides[path] ?? (() => HttpResponse.json(EMPTY_PAGE))),
    ),
  );
}

describe("operations desk", () => {
  it("keeps healthy queue counts when one queue API fails", async () => {
    stubDesk({
      "/api/admin/v1/post-work-items": () =>
        HttpResponse.json({ items: [{ id: "draft-1" }, { id: "draft-2" }] }),
      "/api/admin/v1/payments/reconciliation": () =>
        HttpResponse.json(
          { message: "Internal server error" },
          { status: 500 },
        ),
    });

    renderPage(<HomePage />);

    // 살아있는 큐 숫자는 그대로 보인다.
    expect(
      await screen.findByText("운영이 필요한 게시물 →"),
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    // 죽은 큐는 0으로 접지 않고 이름을 밝힌다.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("일부 대기 건수 집계 실패");
    expect(alert).toHaveTextContent("결제 정산");
  });

  it("shows no failure notice when every queue answers", async () => {
    stubDesk({
      "/api/admin/v1/moderation/reports": () =>
        HttpResponse.json({ items: [{ id: "report-1" }] }),
    });

    renderPage(<HomePage />);

    expect(await screen.findByText("미처리 신고 →")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
