import { apiRequest } from "../../shared/api/apiClient";
import type { CursorPage } from "../../shared/api/useCursorList";

// 홈은 각 화면의 첫 페이지만 세어 규모를 보여준다. 목록 API에 총계가 없어
// 정확한 합계를 낼 수 없고, 운영 판단에는 자릿수와 대기열이면 충분하다.
const PAGE_SIZE = 50;

export type HomeSummary = {
  activeCharacters: number;
  characters: { count: number; hasMore: boolean };
  posts: { count: number; hasMore: boolean };
  users: { count: number; hasMore: boolean };
  inProgressJobs: number;
};

export type HomeActionLog = {
  id: string;
  characterId: string;
  actionType: string;
  reason: string;
  createdAt: string;
};

type CharacterRow = { id: string; status: string };

function tally(page: CursorPage<unknown>): { count: number; hasMore: boolean } {
  return { count: page.items.length, hasMore: Boolean(page.nextCursor) };
}

export async function fetchHomeSummary(): Promise<HomeSummary> {
  const [characters, posts, users, queued, running] = await Promise.all([
    apiRequest<CursorPage<CharacterRow>>(`/characters?limit=${PAGE_SIZE}`),
    apiRequest<CursorPage<unknown>>(`/posts?limit=${PAGE_SIZE}`),
    apiRequest<CursorPage<unknown>>(`/users?limit=${PAGE_SIZE}`),
    apiRequest<CursorPage<unknown>>(
      `/generation/jobs?status=queued&limit=${PAGE_SIZE}`,
    ),
    apiRequest<CursorPage<unknown>>(
      `/generation/jobs?status=running&limit=${PAGE_SIZE}`,
    ),
  ]);
  return {
    activeCharacters: characters.items.filter((row) => row.status === "active")
      .length,
    characters: tally(characters),
    posts: tally(posts),
    users: tally(users),
    inProgressJobs: queued.items.length + running.items.length,
  };
}

export function fetchRecentActionLogs(): Promise<CursorPage<HomeActionLog>> {
  return apiRequest("/character-action-logs?limit=6");
}
