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
  attemptCount?: number;
  startedAt?: string;
  // 종료된 잡에만 내려온다. 진행 중인 잡의 "지금까지"를 소요 시간으로 읽지
  // 않게 하기 위해서다.
  settledAt?: string;
  outputs: DraftShotOutput[];
};

// 기획 LLM이 채우는 부분. 서버가 Json 그대로 돌려주므로 화면이 쓰는 필드만
// 좁게 선언하고 나머지는 원본 보기(details)로 넘긴다.
export type DraftConcept = {
  mode?: string;
  source?: string;
  sceneHint?: string;
  // V3/V4 파이프라인 판별과 정지 지점. V4(검수 없음)는 stage caption/publish에서
  // 사람이 개입한다.
  pipelineVersion?: string;
  pipeline?: { stage?: string; state?: string };
  // V4 ⑥ 전에는 draft.caption이 비어 있다 — 제목 폴백은 기획 전제(premise)다.
  postPlanning?: { output?: { intent?: { premise?: string } } };
  // V3가 운영자 요청을 저장하는 필드. V2의 sceneHint에 대응한다.
  operatorRequest?: string | null;
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

export type DraftEvaluationKind = "plan" | "image_plan" | "prompt" | "image";
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
    // 캡션을 왜 고쳤는지 — 액션 로그에만 남는 측정 원자료.
    reason?: string;
  },
): Promise<Draft> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}`, {
    method: "PATCH",
    body,
  });
}

// 운영자가 파이프라인에 의도를 전달하는 유일한 통로. 평가 지적은 Agent 입력에
// 들어가지 않으므로, 재실행에 무언가를 반영하려면 이 값을 바꿔야 한다.
export function updateOperatorRequest(
  draftId: string,
  operatorRequest: string | null,
): Promise<Draft> {
  return apiRequest(`/drafts/${encodeURIComponent(draftId)}/operator-request`, {
    method: "PATCH",
    body: { operatorRequest },
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
  // V4 ⑥ 캡션 재실행의 일회성 운영자 지시(이번 실행에만 전달).
  body?: { note?: string },
): Promise<Draft> {
  return draftAction(draftId, action, body);
}

// V4(검수 없음): 정지 지점 판별. 컷 재생성·캡션 편집·마감 프리셋이 여기서 갈린다.
export function isPipelineV4(draft: Pick<Draft, "conceptJson">): boolean {
  return draft.conceptJson?.pipelineVersion === "post-pipeline-v4";
}
export function v4PausedAt(
  draft: Pick<Draft, "conceptJson" | "status">,
  stages: ("caption" | "publish")[],
): boolean {
  const pipeline = draft.conceptJson?.pipeline;
  return (
    isPipelineV4(draft) &&
    draft.status === "planned" &&
    pipeline?.state === "pending" &&
    stages.includes(pipeline.stage as "caption" | "publish")
  );
}

// 제목 폴백: 캡션 → 기획 전제(가제) → 없음. V4는 ⑥ 전까지 캡션이 비어 있다.
export function draftTitle(draft: Pick<Draft, "caption" | "conceptJson">): {
  text: string;
  provisional: boolean;
} {
  if (draft.caption.trim()) return { text: draft.caption, provisional: false };
  const premise = draft.conceptJson?.postPlanning?.output?.intent?.premise;
  return premise?.trim()
    ? { text: premise, provisional: true }
    : { text: "(제목 없음)", provisional: true };
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
