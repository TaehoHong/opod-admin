export const REFERENCE_AGENT_STAGES = [
  "reference_select",
  "image_prompt",
  "caption",
] as const;
export type ReferenceAgentStage = (typeof REFERENCE_AGENT_STAGES)[number];
export type ReferenceAgentStageConfig = {
  aiModelId: string;
  provider: string;
  model: string;
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
};
export type ReferenceAgentGenerationConfig = {
  aiModelId: string;
  provider: string;
  effectiveModel: string;
} & (
  | { source: "model"; id?: never; revision?: never }
  | { source?: undefined; id: string; revision: number }
);
export type ReferenceAgentConfig = {
  revision: string | null;
  selection: { batchSize: 12; maxAttempts: number };
  stages?: Record<ReferenceAgentStage, ReferenceAgentStageConfig>;
  generation?: ReferenceAgentGenerationConfig;
};
export type ConfiguredReferenceAgentConfig = ReferenceAgentConfig & {
  revision: string;
  stages: Record<ReferenceAgentStage, ReferenceAgentStageConfig>;
  generation: ReferenceAgentGenerationConfig;
};
