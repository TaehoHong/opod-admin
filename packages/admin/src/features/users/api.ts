import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type UserListItem = {
  id: string;
  displayName: string;
  email?: string;
  followCount: number;
  creditBalance: number;
  createdAt: string;
};

export type UserEvent = {
  id: string;
  userId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  createdAt: string;
};

export function fetchUsers(params: {
  q?: string;
  cursor?: string;
  limit?: string;
}): Promise<CursorPage<UserListItem>> {
  return apiRequest(`/users${toQuery(params)}`);
}

export function fetchUser(userId: string): Promise<UserListItem> {
  return apiRequest(`/users/${encodeURIComponent(userId)}`);
}

export function fetchUserEvents(params: {
  userId: string;
  cursor?: string;
  limit?: string;
}): Promise<CursorPage<UserEvent>> {
  return apiRequest(`/events${toQuery(params)}`);
}
