import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type PostContentType = "feed" | "reel" | "story";

export type PostListItem = {
  id: string;
  characterId: string;
  contentType: PostContentType;
  content: string;
  hashtags: string[];
  commentCount: number;
  reactionCount: number;
  createdAt: string;
};

export function fetchPosts(params: {
  characterId?: string;
  contentType?: string;
  cursor?: string;
}): Promise<CursorPage<PostListItem>> {
  return apiRequest(`/posts${toQuery(params)}`);
}
