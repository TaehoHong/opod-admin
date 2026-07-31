import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type PostContentType = "feed" | "reel" | "story";

export type PostListItem = {
  id: string;
  characterId: string;
  contentType: PostContentType;
  content: string;
  media: PostMedia[];
  hashtags: string[];
  commentCount: number;
  reactionCount: number;
  createdAt: string;
};

export type PostMedia = {
  mediaType: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type PostComment = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  body: string;
  createdAt: string;
};

export type PostReaction = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  reactionType: string;
  createdAt: string;
};

export type CharacterActionLog = {
  id: string;
  characterId: string;
  actionType: string;
  targetTable?: string;
  targetId?: string;
  reason: string;
  createdAt: string;
};

export type PostCreate = {
  actorType: "character";
  actorId: string;
  contentType: Exclude<PostContentType, "story">;
  content: string;
  reason: string;
  hashtags: string[];
  media: Array<{ mediaId: string }>;
};

export type PostCommentCreate = {
  characterId: string;
  body: string;
  reason?: string;
};

export type PostReactionCreate = {
  characterId: string;
  reactionType: string;
  reason?: string;
};

export function fetchPosts(params: {
  characterId?: string;
  contentType?: string;
  cursor?: string;
}): Promise<CursorPage<PostListItem>> {
  return apiRequest(`/posts${toQuery(params)}`);
}

export function fetchPost(postId: string): Promise<PostListItem> {
  return apiRequest(postPath(postId));
}

export function fetchPostComments(
  postId: string,
  params: { cursor?: string; limit?: string } = {},
): Promise<CursorPage<PostComment>> {
  return apiRequest(`${postPath(postId)}/comments${toQuery(params)}`);
}

export function fetchPostReactions(
  postId: string,
  params: { cursor?: string; limit?: string } = {},
): Promise<CursorPage<PostReaction>> {
  return apiRequest(`${postPath(postId)}/reactions${toQuery(params)}`);
}

export function fetchPostActionLogs(
  postId: string,
): Promise<CursorPage<CharacterActionLog>> {
  return apiRequest<CursorPage<CharacterActionLog>>(
    "/character-action-logs",
  ).then((page) => ({
    ...page,
    items: page.items.filter((log) => log.targetId === postId),
  }));
}

export function createPost(body: PostCreate): Promise<PostListItem> {
  return apiRequest("/posts", { method: "POST", body });
}

export function createPostComment(
  postId: string,
  body: PostCommentCreate,
): Promise<{ id: string }> {
  return apiRequest(`${postPath(postId)}/comments`, {
    method: "POST",
    body,
  });
}

export function createPostReaction(
  postId: string,
  body: PostReactionCreate,
): Promise<{ id: string }> {
  return apiRequest(`${postPath(postId)}/reactions`, {
    method: "POST",
    body,
  });
}

function postPath(postId: string) {
  return `/posts/${encodeURIComponent(postId)}`;
}
