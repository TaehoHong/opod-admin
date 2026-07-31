import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type CharacterActionLog = {
  id: string;
  characterId: string;
  actionType: string;
  targetTable?: string;
  targetId?: string;
  reason: string;
  createdAt: string;
};

export function fetchCharacterActionLogs(params: {
  characterId?: string;
  cursor?: string;
}): Promise<CursorPage<CharacterActionLog>> {
  return apiRequest(`/character-action-logs${toQuery(params)}`);
}
