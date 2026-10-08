import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";
export const STAGES = [
  "post_plan",
  "image_plan",
  "image_prompt",
  "generation",
  "caption",
] as const;
export type Stage = (typeof STAGES)[number];
export const LABELS: Record<Stage, string> = {
  post_plan: "게시물 기획",
  image_plan: "이미지 기획",
  image_prompt: "이미지 프롬프트",
  generation: "이미지 생성",
  caption: "캡션",
};
export type AiModel = {
  id: string;
  type: "llm" | "image";
  provider: string;
  model: string;
  createdAt: string;
};
export type AgentConfig = {
  id: string | null;
  stage: Stage;
  revision: number;
  aiModelId: string | null;
  model: string | null;
  provider: string | null;
  effectiveModel: string | null;
  systemPrompt: string | null;
  outputSchema: unknown;
  createdAt: string | null;
};
export type AgentInput = {
  expectedRevision: number;
  aiModelId: string;
  model: string | null;
  systemPrompt: string | null;
  outputSchema: unknown;
};
export const fetchAgents = () =>
  apiRequest<{ items: AgentConfig[] }>("/post-generation-agents");
export const fetchModels = (cursor?: string) =>
  apiRequest<CursorPage<AiModel>>(
    `/post-generation-agents/models${toQuery({ cursor, limit: "50" })}`,
  );
export const createModel = (
  body: Pick<AiModel, "type" | "provider" | "model">,
) =>
  apiRequest<AiModel>("/post-generation-agents/models", {
    method: "POST",
    body,
  });
export const fetchHistory = (stage: Stage, cursor?: string) =>
  apiRequest<CursorPage<AgentConfig>>(
    `/post-generation-agents/${stage}/versions${toQuery({ cursor })}`,
  );
export const saveAgent = (stage: Stage, body: AgentInput) =>
  apiRequest<AgentConfig>(`/post-generation-agents/${stage}/versions`, {
    method: "POST",
    body,
  });
export const restoreAgent = (
  stage: Stage,
  id: string,
  expectedRevision: number,
) =>
  apiRequest<AgentConfig>(
    `/post-generation-agents/${stage}/versions/${id}/restore`,
    { method: "POST", body: { expectedRevision } },
  );

export type NaturalStage =
  | "post_plan"
  | "image_plan"
  | "image_prompt"
  | "caption"
  | "naturalness"
  | "requirements";
export type NaturalConfig = {
  generation?: { provider: string; effectiveModel: string; revision: number };
  schedulerDefault: boolean;
  revision: string;
  planningModel: { aiModelId: string; provider: string; model: string };
  reviewModel: { aiModelId: string; provider: string; model: string };
  prompts: Record<NaturalStage, string>;
};
export const fetchNaturalAgent = () =>
  apiRequest<{
    current: NaturalConfig | null;
    starters: Record<NaturalStage, string>;
  }>("/post-generation-agents/natural/config");
export const saveNaturalAgent = (body: {
  schedulerDefault: boolean;
  expectedRevision: string | null;
  planningAiModelId: string;
  reviewAiModelId: string;
  prompts: Record<NaturalStage, string>;
}) =>
  apiRequest<NaturalConfig>("/post-generation-agents/natural/config", {
    method: "POST",
    body,
  });
