import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

// feature가 자신의 endpoint와 contract를 소유한다
// (docs/06-architecture.md "Frontend").

export type CharacterStatus = "active" | "paused" | "archived";

export type CharacterListItem = {
  id: string;
  publicId: string;
  displayName: string;
  bio: string;
  interests: string[];
  status: CharacterStatus;
  postCount: number;
  followerCount: number;
  createdAt: string;
};

export function fetchCharacters(params: {
  status?: string;
  cursor?: string;
}): Promise<CursorPage<CharacterListItem>> {
  return apiRequest(`/characters${toQuery(params)}`);
}
