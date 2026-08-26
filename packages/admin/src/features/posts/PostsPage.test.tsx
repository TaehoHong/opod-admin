import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useLocation } from "react-router-dom";
import type { SelectHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostsPage } from "./PostsPage";

vi.mock("../../shared/ui/CharacterSelect", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../shared/ui/CharacterSelect")>();
  return {
    ...actual,
    CharacterSelect: ({
      label = "캐릭터",
      ...props
    }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) => (
      <label>
        {label}
        <select aria-label={label} {...props}>
          <option value="">선택하세요</option>
          <option value="character-1">서린</option>
        </select>
      </label>
    ),
  };
});

const item = {
  id: "draft-1",
  kind: "draft",
  draftId: "draft-1",
  characterId: "character-1",
  contentType: "feed",
  caption: "서린의 비 오는 날",
  currentStage: "prompt",
  stageIndex: 3,
  operationalStatus: "needs_action",
  statusDetail: "프롬프트 생성 필요",
  executionMode: "manual",
  source: "manual",
  createdAt: "2026-08-10T01:00:00.000Z",
  updatedAt: "2026-08-10T02:00:00.000Z",
};

const draft = {
  id: "draft-1",
  characterId: "character-1",
  draftType: "post",
  contentType: "feed",
  caption: "서린의 비 오는 날",
  hashtags: [],
  status: "generating",
  attemptCount: 1,
  conceptJson: {
    source: "manual",
    mode: "manual",
    plan: { shots: [{ scene: "창가" }] },
  },
  shots: [
    {
      sortOrder: 0,
      jobId: "job-1",
      status: "draft",
      prompt: "",
      scene: "창가",
      outputs: [],
    },
  ],
  createdAt: "2026-08-10T01:00:00.000Z",
  updatedAt: "2026-08-10T02:00:00.000Z",
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function registerListHandlers(onRequest?: (filter: string | null) => void) {
  server.use(
    http.get("/api/admin/v1/post-work-items", ({ request }) => {
      onRequest?.(new URL(request.url).searchParams.get("filter"));
      return HttpResponse.json({ items: [item] });
    }),
    http.get("/api/admin/v1/post-work-items/:id", () =>
      HttpResponse.json(item),
    ),
    http.get("/api/admin/v1/drafts/:id", () => HttpResponse.json(draft)),
    http.get("/api/admin/v1/drafts/:id/evaluations", () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get("/api/admin/v1/characters", () =>
      HttpResponse.json({
        items: [
          {
            id: "character-1",
            publicId: "seorin",
            displayName: "서린",
          },
        ],
      }),
    ),
  );
}

describe("post operations workspace", () => {
  it("starts with the all queue, shows the six approved columns, and opens a row at its current stage", async () => {
    let requestedFilter: string | null = null;
    registerListHandlers((filter) => {
      requestedFilter = filter;
    });

    renderPage(
      <>
        <PostsPage />
        <LocationProbe />
      </>,
      {
        path: "/posts",
        routes: ["posts", "posts/:workId/:stage"],
      },
    );

    expect(
      await screen.findByRole("columnheader", { name: "게시물" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "캐릭터" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "현재 단계" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "상태" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "게시 일정" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "최근 변경" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "작업" }),
    ).not.toBeInTheDocument();
    expect(requestedFilter).toBe("all");

    const row = screen.getByRole("row", { name: /서린의 비 오는 날/ });
    await userEvent.click(row);

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/posts/draft-1/prompt",
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "③ 프롬프트" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "② 기획" }),
    ).not.toBeInTheDocument();
  });

  it("opens the focused row with Enter", async () => {
    registerListHandlers();
    renderPage(
      <>
        <PostsPage />
        <LocationProbe />
      </>,
      { path: "/posts", routes: ["posts", "posts/:workId/:stage"] },
    );

    const row = await screen.findByRole("row", { name: /서린의 비 오는 날/ });
    row.focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/posts/draft-1/prompt",
      ),
    );
  });

  it("uploads media and publishes a post directly without starting an Agent workflow", async () => {
    let postBody: unknown;
    let queueRequests = 0;
    registerListHandlers(() => {
      queueRequests += 1;
    });
    server.use(
      http.post("/api/admin/v1/media/uploads", async ({ request }) => {
        expect(await request.json()).toEqual({
          mediaType: "image",
          contentType: "image/png",
          fileName: "direct.png",
          byteSize: 5,
          storagePrefix: "pod/feed/character/character-1",
        });
        return HttpResponse.json({
          media: {
            id: "media-1",
            mediaType: "image",
            url: "https://media.test/direct.png",
            uploadedAt: null,
            createdAt: "2026-08-26T00:00:00.000Z",
          },
          uploadUrl: "https://upload.test/direct.png",
          method: "PUT",
          headers: {},
          expiresAt: "2026-08-26T01:00:00.000Z",
        });
      }),
      http.put(
        "https://upload.test/direct.png",
        () => new HttpResponse(null, { status: 200 }),
      ),
      http.post("/api/admin/v1/media/media-1/confirm-upload", () =>
        HttpResponse.json({
          id: "media-1",
          mediaType: "image",
          url: "https://media.test/direct.png",
          uploadedAt: "2026-08-26T00:01:00.000Z",
          createdAt: "2026-08-26T00:00:00.000Z",
        }),
      ),
      http.post("/api/admin/v1/posts", async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({
          id: "post-1",
          characterId: "character-1",
          contentType: "feed",
          content: "직접 올리는 캡션",
          hashtags: ["직접게시"],
          media: [{ mediaType: "image", url: "https://media.test/direct.png" }],
          commentCount: 0,
          reactionCount: 0,
          createdAt: "2026-08-26T00:02:00.000Z",
        });
      }),
    );

    renderPage(<PostsPage />, { path: "/posts", routes: ["posts"] });

    await screen.findByRole("columnheader", { name: "게시물" });
    await userEvent.click(screen.getByRole("button", { name: "직접 게시" }));
    await screen.findByRole("dialog", { name: "직접 게시" });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "작성 캐릭터" }),
      "character-1",
    );
    await userEvent.type(screen.getByLabelText("캡션"), "직접 올리는 캡션");
    await userEvent.type(
      screen.getByRole("combobox", { name: "해시태그" }),
      "직접게시{Enter}",
    );
    const mediaInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(mediaInput).not.toBeNull();
    await userEvent.upload(
      mediaInput!,
      new File(["image"], "direct.png", { type: "image/png" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "바로 게시" }));

    await waitFor(() =>
      expect(postBody).toEqual({
        actorType: "character",
        actorId: "character-1",
        contentType: "feed",
        content: "직접 올리는 캡션",
        hashtags: ["직접게시"],
        reason: "관리자 직접 게시",
        media: [{ mediaId: "media-1" }],
      }),
    );
    await waitFor(() => expect(queueRequests).toBeGreaterThan(1));
  });

  it("creates a manual workflow without exposing a mode choice", async () => {
    let body: unknown;
    registerListHandlers();
    server.use(
      http.post("/api/admin/v1/drafts", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(draft, { status: 201 });
      }),
    );

    renderPage(
      <>
        <PostsPage />
        <LocationProbe />
      </>,
      {
        path: "/posts/new/brief?characterId=character-1",
        routes: ["posts/new/brief", "posts/:workId/:stage"],
      },
    );

    expect(screen.queryByLabelText("진행 방식")).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("장면·주제 요청"),
      "비 오는 날 창가",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "저장하고 기획으로" }),
    );

    await waitFor(() =>
      expect(body).toEqual({
        characterId: "character-1",
        contentType: "feed",
        sceneHint: "비 오는 날 창가",
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/posts/draft-1/plan",
    );
  });
});
