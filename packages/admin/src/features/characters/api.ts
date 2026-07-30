import { apiRequest } from "../../shared/api/apiClient";

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

export type CharacterPage = {
  items: CharacterListItem[];
  nextCursor?: string;
};

export function fetchCharacters(params: {
  status?: string;
  cursor?: string;
}): Promise<CharacterPage> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", params.cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<CharacterPage>(`/characters${suffix}`);
}
