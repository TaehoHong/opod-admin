import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type UserEvent = {
  id: string;
  userId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  createdAt: string;
};

export function fetchEvents(params: {
  userId?: string;
  targetType?: string;
  targetId?: string;
  cursor?: string;
}): Promise<CursorPage<UserEvent>> {
  return apiRequest(`/events${toQuery(params)}`);
}
