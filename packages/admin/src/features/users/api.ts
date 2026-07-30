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

export function fetchUsers(params: {
  q?: string;
  cursor?: string;
}): Promise<CursorPage<UserListItem>> {
  return apiRequest(`/users${toQuery(params)}`);
}
