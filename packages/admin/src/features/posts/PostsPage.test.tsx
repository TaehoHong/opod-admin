import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostsPage } from "./PostsPage";
import type { PostCommentCreate, PostCreate, PostReactionCreate } from "./api";

const character = {
  id: "character-1",
  publicId: "arin",
  displayName: "아린",
};

// Mantine Popover dropdown은 jsdom에서 display:none으로 남아 있어 role 조회의
// 기본 가시성 필터에 걸린다. 목록에도 같은 캐릭터 이름이 나오므로 텍스트 대신
// 옵션 role로 좁힌다.
function findCharacterOption(name: string) {
  return screen.findByRole("option", { name, hidden: true });
}

describe("post management", () => {
  it("opens a post detail with media, comments, reactions, and related action logs", async () => {
    const post = {
      id: "post-detail",
      characterId: "character-1",
      contentType: "feed",
      content: "상세에서 확인할 게시글",
      media: [
        {
          mediaType: "image",
          url: "https://cdn.example/detail.png",
        },
      ],
      hashtags: ["detail"],
      commentCount: 1,
      reactionCount: 1,
      createdAt: "2026-07-31T00:00:00.000Z",
    };
    server.use(
      http.get("/api/admin/v1/posts", () =>
        HttpResponse.json({ items: [post] }),
      ),
      http.get("/api/admin/v1/posts/:postId", () => HttpResponse.json(post)),
      http.get("/api/admin/v1/posts/:postId/comments", () =>
        HttpResponse.json({
          items: [
            {
              id: "comment-1",
              postId: post.id,
              characterId: "character-1",
              body: "상세 댓글",
              createdAt: "2026-07-31T01:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/posts/:postId/reactions", () =>
        HttpResponse.json({
          items: [
            {
              id: "reaction-1",
              postId: post.id,
              characterId: "character-1",
              reactionType: "like",
              createdAt: "2026-07-31T01:01:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/character-action-logs", () =>
        HttpResponse.json({
          items: [
            {
              id: "log-1",
              characterId: "character-1",
              actionType: "POST_CREATED",
              targetTable: "posts",
              targetId: post.id,
              reason: "운영 게시",
              createdAt: "2026-07-31T00:00:00.000Z",
            },
            {
              id: "other-log",
              characterId: "character-1",
              actionType: "POST_CREATED",
              targetTable: "posts",
              targetId: "another-post",
              reason: "다른 게시글",
              createdAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
    );

    renderPage(<PostsPage />, {
      path: "/posts",
      routes: ["posts", "posts/:postId"],
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "상세에서 확인할 게시글" }),
    );

    expect(
      await screen.findByRole("img", { name: "게시글 미디어 1" }),
    ).toHaveAttribute("src", "https://cdn.example/detail.png");
    expect(screen.getByText("상세 댓글")).toBeInTheDocument();
    expect(screen.getByText("like")).toBeInTheDocument();
    expect(screen.getByText("POST_CREATED · 운영 게시")).toBeInTheDocument();
    expect(screen.queryByText("다른 게시글")).not.toBeInTheDocument();
  });

  it("uploads selected media in order, creates a post, and refreshes an empty list", async () => {
    const requests: unknown[] = [];
    let items: Array<Record<string, unknown>> = [];
    let uploadNumber = 0;

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/posts", () => HttpResponse.json({ items })),
      http.post("/api/admin/v1/media/uploads", async ({ request }) => {
        uploadNumber += 1;
        const body = (await request.json()) as { fileName: string };
        return HttpResponse.json({
          media: {
            id: `media-${uploadNumber}`,
            mediaType: body.fileName.endsWith(".mp4") ? "video" : "image",
            url: `https://cdn.example/${body.fileName}`,
            uploadedAt: null,
            createdAt: "2026-07-31T00:00:00.000Z",
          },
          uploadUrl: `https://uploads.example/media-${uploadNumber}`,
          method: "PUT",
          headers: {},
          expiresAt: "2026-07-31T00:10:00.000Z",
        });
      }),
      http.put("https://uploads.example/:mediaId", () => new HttpResponse()),
      http.post("/api/admin/v1/media/:mediaId/confirm-upload", ({ params }) =>
        HttpResponse.json({
          id: params.mediaId,
          mediaType: params.mediaId === "media-2" ? "video" : "image",
          url: `https://cdn.example/${String(params.mediaId)}`,
          uploadedAt: "2026-07-31T00:01:00.000Z",
          createdAt: "2026-07-31T00:00:00.000Z",
        }),
      ),
      http.post("/api/admin/v1/posts", async ({ request }) => {
        const body = (await request.json()) as PostCreate;
        requests.push(body);
        const created = {
          id: "post-1",
          characterId: body.actorId,
          contentType: body.contentType,
          content: body.content,
          hashtags: body.hashtags,
          commentCount: 0,
          reactionCount: 0,
          createdAt: "2026-07-31T01:00:00.000Z",
        };
        items = [created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    renderPage(<PostsPage />, {
      path: "/posts",
      routes: ["posts", "posts/:postId"],
    });

    await screen.findByText("표시할 항목이 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "게시글 작성" }));
    const characterSelect = await screen.findByRole("combobox", {
      name: "작성 캐릭터",
    });
    await userEvent.click(characterSelect);
    await userEvent.click(await findCharacterOption("아린"));
    await userEvent.type(screen.getByLabelText("본문"), "  여름밤 산책  ");
    await userEvent.type(
      screen.getByRole("combobox", { name: "해시태그" }),
      "  film, night  ",
    );
    await userEvent.type(screen.getByLabelText("로그 이유"), "  운영 게시  ");
    const mediaInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(mediaInput).not.toBeNull();
    await userEvent.upload(mediaInput!, [
      new File(["image"], "first.png", { type: "image/png" }),
      new File(["video"], "second.mp4", { type: "video/mp4" }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "게시" }));

    await waitFor(() =>
      expect(requests).toEqual([
        {
          actorType: "character",
          actorId: "character-1",
          contentType: "feed",
          content: "여름밤 산책",
          hashtags: ["film", "night"],
          reason: "운영 게시",
          media: [{ mediaId: "media-1" }, { mediaId: "media-2" }],
        },
      ]),
    );
    expect(await screen.findByText("여름밤 산책")).toBeInTheDocument();
  });

  it("adds a character comment and reaction to a selected post and refreshes its counts", async () => {
    const comments: unknown[] = [];
    const reactions: unknown[] = [];
    let commentCount = 0;
    let reactionCount = 0;

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/posts", () =>
        HttpResponse.json({
          items: [
            {
              id: "post-1",
              characterId: "character-1",
              contentType: "feed",
              content: "기존 게시글",
              hashtags: [],
              commentCount,
              reactionCount,
              createdAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.post("/api/admin/v1/posts/:postId/comments", async ({ request }) => {
        const body = (await request.json()) as PostCommentCreate;
        comments.push(body);
        commentCount += 1;
        return HttpResponse.json({ id: "comment-1", ...body });
      }),
      http.post(
        "/api/admin/v1/posts/:postId/reactions",
        async ({ request }) => {
          const body = (await request.json()) as PostReactionCreate;
          reactions.push(body);
          reactionCount += 1;
          return HttpResponse.json({ id: "reaction-1", ...body });
        },
      ),
    );

    renderPage(<PostsPage />, {
      path: "/posts",
      routes: ["posts", "posts/:postId"],
    });

    const postRow = (await screen.findByText("기존 게시글")).closest("tr");
    expect(postRow).not.toBeNull();
    await userEvent.click(
      within(postRow!).getByRole("button", { name: "댓글" }),
    );
    const commentCharacter = await screen.findByRole("combobox", {
      name: "댓글 작성 캐릭터",
    });
    await userEvent.click(commentCharacter);
    await userEvent.click(await findCharacterOption("아린"));
    await userEvent.type(screen.getByLabelText("댓글 내용"), "  좋아요!  ");
    await userEvent.type(screen.getByLabelText("로그 이유"), "  참여 테스트  ");
    await userEvent.click(screen.getByRole("button", { name: "댓글 생성" }));

    await waitFor(() =>
      expect(comments).toEqual([
        {
          characterId: "character-1",
          body: "좋아요!",
          reason: "참여 테스트",
        },
      ]),
    );
    await waitFor(() =>
      // 열 순서: 캐릭터 · 내용 · 형식 · 해시태그 · 미디어 · 댓글 · 반응 · 작성일 · 작업
      expect(within(postRow!).getAllByRole("cell")[5]).toHaveTextContent("1"),
    );

    await userEvent.click(
      within(postRow!).getByRole("button", { name: "반응" }),
    );
    const reactionCharacter = await screen.findByRole("combobox", {
      name: "반응 캐릭터",
    });
    await userEvent.click(reactionCharacter);
    await userEvent.click(await findCharacterOption("아린"));
    await userEvent.type(screen.getByLabelText("로그 이유"), "  공감 표시  ");
    await userEvent.click(screen.getByRole("button", { name: "반응 생성" }));

    await waitFor(() =>
      expect(reactions).toEqual([
        {
          characterId: "character-1",
          reactionType: "like",
          reason: "공감 표시",
        },
      ]),
    );
    await waitFor(() =>
      expect(within(postRow!).getAllByRole("cell")[6]).toHaveTextContent("1"),
    );
  });

  it("keeps an unresolved interaction submission open and prevents duplicate submission", async () => {
    let requestCount = 0;
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/posts", () =>
        HttpResponse.json({
          items: [
            {
              id: "post-1",
              characterId: "character-1",
              contentType: "feed",
              content: "중복 방지 게시글",
              media: [],
              hashtags: [],
              commentCount: 0,
              reactionCount: 0,
              createdAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.post("/api/admin/v1/posts/:postId/comments", async () => {
        requestCount += 1;
        return new Promise<never>(() => {});
      }),
    );

    renderPage(<PostsPage />, {
      path: "/posts",
      routes: ["posts", "posts/:postId"],
    });

    const row = (await screen.findByText("중복 방지 게시글")).closest("tr");
    await userEvent.click(within(row!).getByRole("button", { name: "댓글" }));
    await userEvent.click(
      await screen.findByRole("combobox", { name: "댓글 작성 캐릭터" }),
    );
    await userEvent.click(await findCharacterOption("아린"));
    await userEvent.type(screen.getByLabelText("댓글 내용"), "한 번만 등록");
    const submit = screen.getByRole("button", { name: "댓글 생성" });
    await userEvent.dblClick(submit);

    await waitFor(() => expect(requestCount).toBe(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  });
});
