import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

// 설정 값의 출처. env 폴백이 살아 있는지 화면에서 구분해야 한다.
export type SettingSource = "db" | "env" | "none";

export type SecretStatus = { set: boolean; last4?: string };

export type GenerationSettingsView = {
  imageProvider: "fal" | "opod-flux";
  falApiKey: SecretStatus;
  falImageModel: string | null;
  falImageT2iModel: string | null;
  opodFluxApiBaseUrl: string | null;
  opodFluxApiKey: SecretStatus;
  llmApiUrl: string | null;
  llmApiKey: SecretStatus;
  llmModel: string | null;
  chat: {
    overrides: {
      apiUrl: string | null;
      apiKey: SecretStatus;
      model: string | null;
      embeddingModel: string | null;
    };
    effective: {
      apiUrl: string | null;
      apiKeyLast4: string | null;
      model: string | null;
      embeddingModel: string;
      overridden: {
        apiUrl: boolean;
        apiKey: boolean;
        model: boolean;
        embeddingModel: boolean;
      };
    };
  };
  resolved: {
    t2iProvider: string | null;
    editProvider: string | null;
    plannerProvider: string;
    sources: {
      provider: SettingSource;
      apiKey: SettingSource;
      editModel: SettingSource;
      t2iModel: SettingSource;
      opodFluxApiBaseUrl: SettingSource;
      opodFluxApiKey: SettingSource;
    };
    plannerSources: {
      apiUrl: SettingSource;
      apiKey: SettingSource;
      model: SettingSource;
    };
  };
  // 게시 포맷별 생성 이미지 종횡비. source가 "default"면 저장한 적이 없어
  // 코드 기본값을 쓰는 중이다.
  aspectRatios: {
    overrides: {
      feed: string | null;
      story: string | null;
      reel: string | null;
    };
    effective: Record<
      "feed" | "story" | "reel",
      { value: string; source: "db" | "default" }
    >;
  };
  pipelineV3: {
    enabled: boolean;
    source: SettingSource;
  };
  // enabledSource가 "env"면 아직 UI에서 저장한 적이 없어 env 기본값을 쓰는 중.
  worker: {
    enabled: boolean;
    enabledSource: SettingSource;
    dailyBudgetUsd: number | null;
    jobCostEstimateUsd: number;
    todaySpendUsd: number;
  };
};

// 누락 = 유지, null = 삭제(상위 값 복귀), 값 = 저장.
// UpdateGenerationSettingsDto의 시맨틱을 그대로 따른다.
export type GenerationSettingsUpdate = {
  imageProvider?: "fal" | "opod-flux" | null;
  falApiKey?: string | null;
  falImageModel?: string | null;
  falImageT2iModel?: string | null;
  opodFluxApiBaseUrl?: string | null;
  opodFluxApiKey?: string | null;
  llmApiUrl?: string | null;
  llmApiKey?: string | null;
  llmModel?: string | null;
  agentLlmApiUrl?: string | null;
  agentLlmApiKey?: string | null;
  agentLlmModel?: string | null;
  agentEmbeddingModel?: string | null;
  // 워커 자동 루프 — null = env 기본값으로 복귀.
  workerEnabled?: boolean | null;
  pipelineV3Enabled?: boolean | null;
  // 종횡비 — null = 코드 기본값으로 복귀.
  aspectRatioFeed?: string | null;
  aspectRatioStory?: string | null;
  aspectRatioReel?: string | null;
};

export type ConnectionTestTarget = "image" | "planner" | "chat";

export type ConnectionTestResult = { ok: boolean; message: string };

export type SettingsChangeLog = {
  id: string;
  adminEmail: string | null;
  actionType: string;
  target: string | null;
  summary: string | null;
  createdAt: string;
};

export function fetchGenerationSettings(): Promise<GenerationSettingsView> {
  return apiRequest("/settings/generation");
}

export function updateGenerationSettings(
  body: GenerationSettingsUpdate,
): Promise<GenerationSettingsView> {
  return apiRequest("/settings/generation", { method: "PUT", body });
}

export function testGenerationSettings(body: {
  target: ConnectionTestTarget;
  imageProvider?: "fal" | "opod-flux";
  falApiKey?: string;
  opodFluxApiBaseUrl?: string;
  opodFluxApiKey?: string;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
}): Promise<ConnectionTestResult> {
  return apiRequest("/settings/generation/test", { method: "POST", body });
}

export function fetchSettingChanges(): Promise<{ items: SettingsChangeLog[] }> {
  return apiRequest("/settings/generation/changes");
}

export function fetchQueuedJobs(): Promise<CursorPage<{ id: string }>> {
  return apiRequest(`/generation/jobs${toQuery({ status: "queued" })}`);
}

// 자동 루프가 꺼져 있어도 대기 중인 다음 작업 하나를 처리한다.
export function runWorkerOnce(): Promise<{ jobId?: string }> {
  return apiRequest("/generation/worker/run", { method: "POST" });
}
