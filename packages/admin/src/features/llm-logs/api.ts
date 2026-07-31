import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type LlmLogStatus = "running" | "succeeded" | "failed";

export type LlmLogListItem = {
  id: string;
  type: string;
  provider: string;
  model: string;
  status: LlmLogStatus;
  isStreaming: boolean;
  requestId: string | null;
  providerRequestId: string | null;
  userId: string | null;
  characterId: string | null;
  generationJobId: string | null;
  httpStatus: number | null;
  errorType: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  createdAt: string;
  completedAt?: string;
  mediaCount: number;
};

export type LlmLogMediaItem = {
  id: string;
  role: string;
  sortOrder: number;
  url: string;
  mediaType: string;
  contentType: string | null;
};

export type LlmLogDetail = Omit<LlmLogListItem, "mediaCount"> & {
  endpoint: string | null;
  systemPromptJson: unknown;
  userPromptJson: unknown;
  requestJson: unknown;
  responseJson: unknown;
  metadataJson: unknown;
  redactedPaths: string[];
  errorMessage: string | null;
  media: LlmLogMediaItem[];
};

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
};

export type TokenBreakdown = TokenTotals & { key: string };
export type TokenDailyPoint = TokenTotals & { date: string };

export type TokenUsageSummary = {
  days: number;
  from: string;
  totals: TokenTotals;
  daily: TokenDailyPoint[];
  byProvider: TokenBreakdown[];
  byModel: TokenBreakdown[];
};

export function fetchLlmLogs(params: {
  status?: string;
  type?: string;
  provider?: string;
  model?: string;
  cursor?: string;
}): Promise<CursorPage<LlmLogListItem>> {
  return apiRequest(`/llm-logs${toQuery(params)}`);
}

export function fetchLlmLog(id: string): Promise<LlmLogDetail> {
  return apiRequest(`/llm-logs/${encodeURIComponent(id)}`);
}

export function fetchTokenUsage(days: number): Promise<TokenUsageSummary> {
  return apiRequest(`/llm-logs/usage${toQuery({ days: String(days) })}`);
}
