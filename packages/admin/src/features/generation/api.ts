import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type JobStatus = "draft" | "queued" | "running" | "completed" | "failed";

export type OutputCandidate = {
  mediaId: string;
  url: string;
  candidateIndex: number;
  selected: boolean;
};

export type GenerationJob = {
  id: string;
  characterId: string;
  mediaType: "image" | "video";
  prompt: string;
  inputPrompt?: string;
  // 위저드가 LLM으로 확장한 장면. 없으면 원문이 그대로 장면이다.
  expandedScene?: string;
  plannerName?: string;
  aspectRatio?: string;
  candidateCount?: number;
  status: JobStatus;
  outputMediaId?: string;
  provider?: string;
  attemptCount: number;
  draftId?: string;
  originJobId?: string;
  errorMessage?: string;
  costUsd?: string;
  outputs?: OutputCandidate[];
  generationContext?: {
    negativePrompt: string;
    referenceImageCount: number;
    route: "t2i" | "edit";
  };
  createdAt: string;
  updatedAt: string;
};

export function fetchGenerationJobs(params: {
  status?: string;
  cursor?: string;
}): Promise<CursorPage<GenerationJob>> {
  return apiRequest(`/generation/jobs${toQuery(params)}`);
}

export function fetchGenerationJob(jobId: string): Promise<GenerationJob> {
  return apiRequest(`/generation/jobs/${encodeURIComponent(jobId)}`);
}

export type EnqueueGenerationJobInput = {
  characterId: string;
  mediaType: "image" | "video";
  prompt: string;
};

export function enqueueGenerationJob(
  body: EnqueueGenerationJobInput,
): Promise<GenerationJob> {
  return apiRequest("/generation/jobs", { method: "POST", body });
}

export type CompleteGenerationJobInput = {
  mediaId?: string;
  url?: string;
};

export function completeGenerationJob(
  jobId: string,
  body: CompleteGenerationJobInput,
): Promise<GenerationJob> {
  return apiRequest(`/generation/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body,
  });
}

// ── 이미지 위저드 ────────────────────────────────────────────────────────
// 확정(confirm) 전에는 프로바이더를 호출하지 않으므로 비용이 들지 않는다.

export function createImageDraft(body: {
  characterId: string;
  inputPrompt: string;
  candidateCount: number;
  aspectRatio?: string;
}): Promise<GenerationJob> {
  return apiRequest("/generation/image-jobs/draft", { method: "POST", body });
}

export function updateImageDraft(
  jobId: string,
  body: { prompt: string; candidateCount: number },
): Promise<GenerationJob> {
  return apiRequest(`/generation/jobs/${encodeURIComponent(jobId)}/draft`, {
    method: "PATCH",
    body,
  });
}

export function confirmImageDraft(jobId: string): Promise<GenerationJob> {
  return apiRequest(`/generation/jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
    body: {},
  });
}

export function selectJobOutput(
  jobId: string,
  mediaId: string,
): Promise<GenerationJob> {
  return apiRequest(
    `/generation/jobs/${encodeURIComponent(jobId)}/select-output`,
    { method: "POST", body: { mediaId } },
  );
}

// 새 회차 — 현재 잡을 원본으로 두고 프롬프트 수정 단계부터 다시 시작한다.
export function regenerateJob(jobId: string): Promise<GenerationJob> {
  return apiRequest(
    `/generation/jobs/${encodeURIComponent(jobId)}/regenerate`,
    { method: "POST", body: {} },
  );
}

export function retryJob(jobId: string, reason?: string): Promise<unknown> {
  return apiRequest(`/generation/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

// 워커 수동 실행 — jobId를 주면 그 잡, 없으면 다음 대기 잡.
export function runWorker(jobId?: string): Promise<{ jobId?: string }> {
  return apiRequest("/generation/worker/run", {
    method: "POST",
    body: jobId ? { jobId } : {},
  });
}

// 재생성은 originJobId로 이전 회차를 가리킨다. 사슬을 거슬러 올라가 오래된
// 회차부터 돌려준다.
export async function fetchJobHistory(
  originJobId?: string,
): Promise<GenerationJob[]> {
  const history: GenerationJob[] = [];
  const seen = new Set<string>();
  let cursor = originJobId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    try {
      const ancestor = await fetchGenerationJob(cursor);
      history.push(ancestor);
      cursor = ancestor.originJobId;
    } catch {
      break;
    }
  }
  return history.reverse();
}

export type ResolvedProviders = {
  t2iProvider: string | null;
  editProvider: string | null;
  plannerProvider: string;
};

// 지금 무엇이 적용 중인지만 읽는다. 변경은 설정 화면이 담당한다.
export function fetchResolvedProviders(): Promise<ResolvedProviders> {
  return apiRequest<{ resolved: ResolvedProviders }>(
    "/settings/generation",
  ).then((settings) => settings.resolved);
}

// 위저드 단계 — 잡 상태에서 유도한다. 별도 상태 필드를 만들지 않는다.
export type WizardStep =
  "prompt" | "generating" | "select" | "complete" | "failed";

export function wizardStep(job: GenerationJob): WizardStep {
  if (job.status === "queued" || job.status === "running") return "generating";
  if (job.status === "completed") {
    return job.outputMediaId ? "complete" : "select";
  }
  if (job.status === "failed") return "failed";
  return "prompt";
}

export const WIZARD_STEPS = [
  "요청 입력",
  "프롬프트 확인",
  "후보 생성",
  "후보 선택",
];

export function wizardStepIndex(job: GenerationJob): number {
  const step = wizardStep(job);
  if (step === "prompt") return 1;
  if (step === "generating" || step === "failed") return 2;
  return 3;
}
