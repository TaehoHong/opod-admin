import { apiRequest } from "../../shared/api/apiClient";
import { toQuery } from "../../shared/api/useCursorList";

export type AnalyticsMetricName =
  | "events.count"
  | "messages.count"
  | "credits.granted"
  | "credits.debited"
  | "generation_jobs.count";

export type AnalyticsMetric = {
  name: AnalyticsMetricName;
  value: number;
};

export type TopHashtag = {
  hashtag: string;
  postCount: number;
};

// 화면은 기간을 일수로 고르고 서버에는 절대 시각으로 보낸다. 서버가
// createdAt 범위만 받기 때문이다 (admin.service.ts getAnalytics).
export function analyticsDateRange(
  days: number,
  now: Date = new Date(),
): { from: string; to: string } {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function fetchAnalytics(
  days: number,
): Promise<{ metrics: AnalyticsMetric[] }> {
  return apiRequest(`/analytics${toQuery(analyticsDateRange(days))}`);
}

export function fetchTopHashtags(
  limit: number,
): Promise<{ items: TopHashtag[] }> {
  return apiRequest(`/analytics/hashtags${toQuery({ limit: String(limit) })}`);
}
