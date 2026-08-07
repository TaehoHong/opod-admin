// 기획 평가(plan evaluation) 단계 — 저장된 콘텐츠 플랜을 8차원 루브릭으로
// LLM 심사한다. 프롬프트 텍스트는 prompts/plan-evaluator.ts에서 관리한다.
// 평가는 draft 상태 머신에 영향을 주지 않는 참고 데이터다
// (docs/plan-prompt-evaluation-agent.md).

import {
  PLAN_EVAL_DIMENSIONS,
  PLAN_EVALUATOR_SYSTEM_PROMPT,
  PlanEvalDimension,
  PlanEvaluationPromptInput,
  buildPlanEvaluatorUserPrompt,
} from "../../prompts/plan-evaluator";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";
import { contentFromChatCompletion } from "./content-planner";
import { PlannerProviderSettings } from "./content-planner";

export type { PlanEvaluationPromptInput } from "../../prompts/plan-evaluator";

export type DimensionScore = { score: number; reason: string };

export type PlanEvaluationResult = {
  scores: Record<PlanEvalDimension, DimensionScore>;
  issues: { dimension: string; detail: string }[];
  suggestions: string[];
  overallScore: number;
};

export type PlanEvaluator = {
  readonly name: string;
  evaluate(
    input: PlanEvaluationPromptInput,
    context?: LlmLogContext,
  ): Promise<PlanEvaluationResult>;
};

const HTTP_TIMEOUT_MS = 60_000;

// 플래너와 같은 resolver closure 계약 — 설정이 불완전하면 실행 시점에
// 명시적으로 실패하는 unconfigured 평가자를 돌려준다.
export function resolvePlanEvaluator(
  settings: PlannerProviderSettings,
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): PlanEvaluator {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  if (!apiUrl || !apiKey || !model) {
    return {
      name: "unconfigured",
      evaluate: () =>
        Promise.reject(new Error("plan evaluator LLM is not configured")),
    };
  }
  const config = { apiUrl, apiKey, model };
  return {
    name: `llm:${config.model}`,
    async evaluate(input, context) {
      const requestJson = {
        model: config.model,
        messages: [
          { role: "system", content: PLAN_EVALUATOR_SYSTEM_PROMPT },
          { role: "user", content: buildPlanEvaluatorUserPrompt(input) },
        ],
      };
      const execute = () =>
        fetchFn(config.apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestJson),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      const response = llmLogs
        ? await llmLogs.runJsonFetch({
            type: LLM_LOG_TYPE.planEvaluate,
            provider: "openai-compatible",
            model: config.model,
            endpoint: config.apiUrl,
            requestJson,
            context,
            execute,
          })
        : await execute();
      if (!response.ok) {
        throw new Error(`plan evaluator LLM failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("plan evaluator LLM returned no content");
      }
      return parsePlanEvaluation(content);
    },
  };
}

// LLM 출력 검증 — 8차원 전부, 정수 1~5, 사유 필수. 오염된 평가가 DB와
// 집계에 유입되지 않게 여기서 거절한다.
export function parsePlanEvaluation(raw: string): PlanEvaluationResult {
  const parsed = extractJson(raw);
  if (!isRecord(parsed) || !isRecord(parsed.scores)) {
    throw new Error("plan evaluation is missing scores");
  }
  const scores = {} as Record<PlanEvalDimension, DimensionScore>;
  for (const dimension of PLAN_EVAL_DIMENSIONS) {
    const entry = parsed.scores[dimension];
    if (!isRecord(entry)) {
      throw new Error(`plan evaluation is missing dimension ${dimension}`);
    }
    scores[dimension] = validateScore(entry, dimension);
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.flatMap((issue) =>
        isRecord(issue) &&
        typeof issue.dimension === "string" &&
        typeof issue.detail === "string"
          ? [{ dimension: issue.dimension, detail: issue.detail }]
          : [],
      )
    : [];
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const overallScore = round2(
    PLAN_EVAL_DIMENSIONS.reduce(
      (sum, dimension) => sum + scores[dimension].score,
      0,
    ) / PLAN_EVAL_DIMENSIONS.length,
  );
  return { scores, issues, suggestions, overallScore };
}

export function validateScore(
  entry: Record<string, unknown>,
  label: string,
): DimensionScore {
  const score = entry.score;
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) {
    throw new Error(`evaluation dimension ${label} has invalid score`);
  }
  const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
  if (!reason) {
    throw new Error(`evaluation dimension ${label} is missing a reason`);
  }
  return { score: score as number, reason };
}

export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const jsonText = text.startsWith("{")
    ? text
    : (text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error("evaluation output is not valid JSON");
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
