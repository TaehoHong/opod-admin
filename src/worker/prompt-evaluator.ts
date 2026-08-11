// 프롬프트 평가(prompt evaluation) 단계 — 빌드된 컷별 영어 프롬프트를
// 배치 1콜로 LLM 심사한다 (Layer 2). 정적 린트(Layer 1)는 prompt-lint.ts.
// 프롬프트 텍스트는 prompts/prompt-evaluator.ts에서 관리한다.
// docs/image-prompt-evaluation-agent.md.

import {
  PROMPT_EVAL_SHOT_DIMENSIONS,
  PROMPT_EVALUATOR_SYSTEM_PROMPT,
  PromptEvalShotDimension,
  PromptEvaluationPromptInput,
  buildPromptEvaluatorUserPrompt,
} from "../../prompts/prompt-evaluator";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";
import {
  PlannerProviderSettings,
  contentFromChatCompletion,
} from "./content-planner";
import {
  DimensionScore,
  extractJson,
  round2,
  validateScore,
} from "./plan-evaluator";

export type { PromptEvaluationPromptInput } from "../../prompts/prompt-evaluator";

export type PromptShotEvaluation = {
  sortOrder: number;
  scores: Record<PromptEvalShotDimension, DimensionScore>;
  issues: string[];
  suggestions: string[];
};

export type PromptEvaluationResult = {
  shots: PromptShotEvaluation[];
  crossShot: { score: number; issues: string[] };
  overallScore: number;
};

export type PromptEvaluator = {
  readonly name: string;
  evaluate(
    input: PromptEvaluationPromptInput,
    context?: LlmLogContext,
  ): Promise<PromptEvaluationResult>;
};

const HTTP_TIMEOUT_MS = 60_000;

export function resolvePromptEvaluator(
  settings: PlannerProviderSettings,
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): PromptEvaluator {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  if (!apiUrl || !apiKey || !model) {
    return {
      name: "unconfigured",
      evaluate: () =>
        Promise.reject(new Error("prompt evaluator LLM is not configured")),
    };
  }
  const config = { apiUrl, apiKey, model };
  return {
    name: `llm:${config.model}`,
    async evaluate(input, context) {
      const requestJson = {
        model: config.model,
        messages: [
          { role: "system", content: PROMPT_EVALUATOR_SYSTEM_PROMPT },
          { role: "user", content: buildPromptEvaluatorUserPrompt(input) },
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
            type: LLM_LOG_TYPE.promptEvaluate,
            provider: "openai-compatible",
            model: config.model,
            endpoint: config.apiUrl,
            requestJson,
            context,
            execute,
          })
        : await execute();
      if (!response.ok) {
        throw new Error(`prompt evaluator LLM failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("prompt evaluator LLM returned no content");
      }
      return parsePromptEvaluation(
        content,
        input.shots.map((shot) => shot.sortOrder),
      );
    },
  };
}

// 컷 수·순서 일치와 차원 완결성을 검증한다 — 빌더의 컷 수 검증과 같은 취지.
export function parsePromptEvaluation(
  raw: string,
  expectedSortOrders: number[],
): PromptEvaluationResult {
  const parsed = extractJson(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.shots)) {
    throw new Error("prompt evaluation is missing shots");
  }
  if (parsed.shots.length !== expectedSortOrders.length) {
    throw new Error(
      `prompt evaluation returned ${parsed.shots.length} shot(s) for ${expectedSortOrders.length} expected`,
    );
  }
  const shots = parsed.shots.map((entry, index) => {
    if (!isRecord(entry) || entry.sortOrder !== expectedSortOrders[index]) {
      throw new Error(`prompt evaluation shot ${index} has invalid sortOrder`);
    }
    if (!isRecord(entry.scores)) {
      throw new Error(`prompt evaluation shot ${index} is missing scores`);
    }
    const scores = {} as Record<PromptEvalShotDimension, DimensionScore>;
    for (const dimension of PROMPT_EVAL_SHOT_DIMENSIONS) {
      const value = entry.scores[dimension];
      if (!isRecord(value)) {
        throw new Error(
          `prompt evaluation shot ${index} is missing dimension ${dimension}`,
        );
      }
      scores[dimension] = validateScore(value, `shot ${index} ${dimension}`);
    }
    return {
      sortOrder: expectedSortOrders[index],
      scores,
      issues: stringArray(entry.issues),
      suggestions: stringArray(entry.suggestions),
    };
  });
  if (!isRecord(parsed.crossShot)) {
    throw new Error("prompt evaluation is missing crossShot");
  }
  const crossShotScore = parsed.crossShot.score;
  if (
    !Number.isInteger(crossShotScore) ||
    (crossShotScore as number) < 1 ||
    (crossShotScore as number) > 5
  ) {
    throw new Error("prompt evaluation crossShot has invalid score");
  }
  const crossShot = {
    score: crossShotScore as number,
    issues: stringArray(parsed.crossShot.issues),
  };
  const dimensionScores = shots.flatMap((shot) =>
    PROMPT_EVAL_SHOT_DIMENSIONS.map(
      (dimension) => shot.scores[dimension].score,
    ),
  );
  const overallScore = round2(
    [...dimensionScores, crossShot.score].reduce(
      (sum, score) => sum + score,
      0,
    ) /
      (dimensionScores.length + 1),
  );
  return { shots, crossShot, overallScore };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
