import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type DraftStatus =
  | "planned"
  | "generating"
  | "needs_review"
  | "regenerating"
  | "approved"
  | "rejected"
  | "published"
  | "failed";

export type FinishPreset = "none" | "film" | "mono-film";

export type DraftShotOutput = {
  mediaId: string;
  url: string;
  candidateIndex: number;
  selected: boolean;
  filterPreset: string | null;
};

export type DraftReference = {
  mediaId: string;
  url?: string;
  available: boolean;
};

export type GenerationTrace = {
  captureSetup?: string;
  characterVisible?: boolean;
  planned: {
    route?: "t2i" | "edit";
    targetModelId?: string;
    references: DraftReference[];
  };
  execution?: {
    route: "t2i" | "edit";
    provider?: string;
    references: DraftReference[];
  };
  matchesPlan?: boolean;
};

export type DraftShot = {
  sortOrder: number;
  jobId: string;
  status: string;
  prompt: string;
  scene?: string;
  references?: { mediaId: string; url: string }[];
  generationTrace?: GenerationTrace;
  candidateCount?: number;
  provider?: string;
  costUsd?: string;
  errorMessage?: string;
  outputs: DraftShotOutput[];
};

// 기획 LLM이 채우는 부분. 서버가 Json 그대로 돌려주므로 화면이 쓰는 필드만
// 좁게 선언하고 나머지는 원본 보기(details)로 넘긴다.
export type DraftConcept = {
  mode?: string;
  source?: string;
  sceneHint?: string;
  plannerName?: string;
  builderName?: string;
  finish?: string;
  plan?: {
    caption?: string;
    hashtags?: string[];
    shots?: { scene?: string }[];
  };
  planInput?: {
    personas?: { title?: string }[];
    memories?: string[];
    recentCaptions?: string[];
    sceneHint?: string;
  };
};

export type Draft = {
  id: string;
  characterId: string;
  locationId?: string;
  draftType: string;
  contentType: string;
  caption: string;
  hashtags: string[];
  status: DraftStatus;
  attemptCount: number;
  errorMessage?: string;
  scheduledAt?: string;
  publishedPostId?: string;
  conceptJson?: DraftConcept;
  shots?: DraftShot[];
  createdAt: string;
  updatedAt: string;
};

export type DraftEvaluationKind = "plan" | "prompt" | "image";
export type DraftEvaluationStatus = "pending" | "completed" | "failed";

export type DraftEvaluation = {
  id: string;
  draftId: string;
  kind: DraftEvaluationKind;
  attempt: number;
  status: DraftEvaluationStatus;
  evaluatorName?: string | null;
  rubricVersion: string;
  contentLanguage: string;
  overallScore?: number | null;
  scoresJson?: unknown;
  issuesJson?: unknown;
  suggestionsJson?: unknown;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export function fetchDrafts(params: {
  status?: string;
  characterId?: string;
  limit?: string;
  cursor?: string;
}): Promise<CursorPage<Draft>> {
  return apiRequest(`/drafts${toQuery(params)}`);
}

export function fetchDraft(draftId: string): Promise<Draft> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}`);
}

export function fetchDraftEvaluations(
  draftId: string,
): Promise<{ items: DraftEvaluation[] }> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}/evaluations`);
}

export function createDraft(body: {
  characterId: string;
  sceneHint?: string;
  scheduledAt?: string;
  contentType?: "feed" | "reel";
}): Promise<Draft> {
  return apiRequest("/drafts", { method: "POST", body });
}

export function updateDraftPlan(
  draftId: string,
  body: {
    caption: string;
    hashtags: string[];
    shots: { sortOrder: number; scene: string }[];
  },
): Promise<Draft> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}/plan`, {
    method: "PATCH",
    body,
  });
}

export function updateDraftPrompts(
  draftId: string,
  body: { items: { jobId: string; prompt: string }[] },
): Promise<Draft> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}/prompts`, {
    method: "PATCH",
    body,
  });
}

export function updateDraft(
  draftId: string,
  body: {
    caption?: string;
    hashtags?: string[];
    scheduledAt?: string | null;
    finish?: string | null;
  },
): Promise<Draft> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}`, {
    method: "PATCH",
    body,
  });
}

// 단계 실행 — 전부 갱신된 draft를 돌려주므로 호출부는 결과를 캐시에 그대로
// 넣으면 된다.
function draftAction(draftId: string, path: string, body?: unknown) {
  return apiRequest<Draft>(`/drafts/${encodeURIComponent(draftId)}/${path}`, {
    method: "POST",
    ...(body === undefined ? {} : { body }),
  });
}

export type DraftStageAction =
  "plan" | "build-prompts" | "aggregate" | "publish" | "approve";

export function runDraftStage(
  draftId: string,
  action: DraftStageAction,
): Promise<Draft> {
  return draftAction(draftId, action);
}

export function rejectDraft(draftId: string, reason?: string): Promise<Draft> {
  return draftAction(draftId, "reject", reason ? { reason } : {});
}

export function generateShot(
  draftId: string,
  jobId: string,
  body: { prompt?: string; candidateCount?: number },
): Promise<Draft> {
  return draftAction(
    draftId,
    `jobs/${encodeURIComponent(jobId)}/generate`,
    body,
  );
}

export function regenerateShot(
  draftId: string,
  jobId: string,
  body: { prompt?: string } = {},
): Promise<Draft> {
  return draftAction(
    draftId,
    `jobs/${encodeURIComponent(jobId)}/regenerate`,
    body,
  );
}

export function selectShotOutput(
  draftId: string,
  jobId: string,
  mediaId: string,
): Promise<Draft> {
  return draftAction(draftId, `jobs/${encodeURIComponent(jobId)}/select`, {
    mediaId,
  });
}

export function updateShotOutputFilter(
  draftId: string,
  jobId: string,
  mediaId: string,
  filterPreset: FinishPreset,
): Promise<Draft> {
  return apiRequest(
    `/drafts/${encodeURIComponent(draftId)}/jobs/${encodeURIComponent(
      jobId,
    )}/outputs/${encodeURIComponent(mediaId)}/filter`,
    { method: "PATCH", body: { filterPreset } },
  );
}

// 마감 미리보기는 서버가 즉석에서 만든 JPEG 바이트다. cookie 세션이라
// <img src>로 바로 걸 수 있다.
export function finishPreviewUrl(
  mediaId: string,
  preset: Exclude<FinishPreset, "none">,
): string {
  return `/api/admin/v1/media/${encodeURIComponent(
    mediaId,
  )}/film-finish?preset=${preset}`;
}

export function isFinishPreset(value: unknown): value is FinishPreset {
  return value === "none" || value === "film" || value === "mono-film";
}

// 출력별 프리셋이 없으면 초안 전체의 마감 설정을 따른다.
export function outputFinishPreset(
  draft: Draft,
  output: DraftShotOutput,
): FinishPreset {
  if (isFinishPreset(output.filterPreset)) return output.filterPreset;
  const draftFinish = draft.conceptJson?.finish;
  return isFinishPreset(draftFinish) ? draftFinish : "none";
}
