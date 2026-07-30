import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type ReportStatus = "submitted" | "reviewing" | "resolved" | "rejected";

export type ReportListItem = {
  id: string;
  reporterUserId: string;
  targetType: "character" | "post" | "message";
  targetId: string;
  reason: string;
  details?: string;
  resolution?: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
};

export function fetchReports(params: {
  status?: string;
  cursor?: string;
}): Promise<CursorPage<ReportListItem>> {
  return apiRequest(`/moderation/reports${toQuery(params)}`);
}

export function updateReport(input: {
  reportId: string;
  status: ReportStatus;
  resolution?: string;
}): Promise<unknown> {
  const { reportId, ...body } = input;
  return apiRequest(`/moderation/reports/${reportId}`, {
    method: "PATCH",
    body,
  });
}
