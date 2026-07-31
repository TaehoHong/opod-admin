// 포스트 기획(content_plan) 단계. 페르소나·메모리·최근 캡션을 조립해 LLM에게
// 포스트 컨셉(캡션/해시태그/샷 리스트)을 구조화 출력으로 받는다.
// 프롬프트 텍스트는 prompts/content-planner.ts에서 관리한다.
// env(LLM_API_URL/LLM_API_KEY/LLM_MODEL, OpenAI-compatible chat completions)가
// 없으면 기획 단계가 명시적으로 실패한다.

import {
  ContentPlanInput,
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserPrompt,
  clampShots,
} from "../../prompts/content-planner";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";

export type { ContentPlanInput } from "../../prompts/content-planner";

export type ContentPlanShot = {
  sortOrder: number;
  scene: string;
  captureSetup: string;
  characterVisible: boolean;
  referenceIds: string[];
};

export type ContentPlan = {
  caption: string;
  hashtags: string[];
  // referenceIds: 카탈로그에서 고른 샷별 레퍼런스. 인물 비노출 샷만
  // 빈 배열을 허용한다.
  shots: ContentPlanShot[];
};

export class ShotReferencePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShotReferencePolicyError";
  }
}

export function assertVisibleCharacterHasReference(
  characterVisible: boolean,
  referenceCount: number,
  shotLabel: string,
): void {
  if (characterVisible && referenceCount === 0) {
    throw new ShotReferencePolicyError(
      `${shotLabel} shows the character but has no usable identity reference`,
    );
  }
}

export type ContentPlanner = {
  readonly name: string;
  plan(input: ContentPlanInput, context?: LlmLogContext): Promise<ContentPlan>;
};

const HTTP_TIMEOUT_MS = 60_000;
const HASHTAG_MAX = 5;
// 샷당 선별 레퍼런스 상한.
const SHOT_REFERENCES_MAX = 3;

// 플래너 구성 값 — 출처는 env 또는 admin_settings(DB)이며 이 계층은 출처를
// 모른다. 병합/우선순위는 GenerationSettingsService가 담당한다.
export type PlannerProviderSettings = {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
};

// 세 값이 모두 있어야 LLM 플래너를 사용할 수 있다.
export function resolveContentPlanner(
  settings: PlannerProviderSettings,
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ContentPlanner {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  if (!apiUrl || !apiKey || !model) {
    return {
      name: "unconfigured",
      plan: () =>
        Promise.reject(new Error("content planner LLM is not configured")),
    };
  }
  return createLlmContentPlanner({ apiUrl, apiKey, model }, fetchFn, llmLogs);
}

export function createLlmContentPlanner(
  config: { apiUrl: string; apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ContentPlanner {
  return {
    name: `llm:${config.model}`,
    async plan(input, context) {
      const requestJson = {
        model: config.model,
        messages: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: buildPlannerUserPrompt(input) },
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
            type: LLM_LOG_TYPE.contentPlan,
            provider: "openai-compatible",
            model: config.model,
            endpoint: config.apiUrl,
            requestJson,
            context,
            execute,
          })
        : await execute();
      if (!response.ok) {
        throw new Error(`content planner LLM failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("content planner LLM returned no content");
      }
      return parseContentPlan(
        content,
        clampShots(input.maxShots),
        (input.referenceCatalog ?? []).map((reference) => reference.id),
      );
    },
  };
}

// LLM 출력에서 JSON을 견고하게 추출·검증한다 (마크다운 펜스 허용).
// referenceIds는 카탈로그에 실재하는 id만 통과시킨다 (환각 방지).
export function parseContentPlan(
  raw: string,
  maxShots: number,
  allowedReferenceIds: string[] = [],
): ContentPlan {
  const text = raw.trim();
  const jsonText = text.startsWith("{")
    ? text
    : (text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("content plan is not valid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.caption !== "string") {
    throw new Error("content plan is missing a caption");
  }
  const caption = parsed.caption.trim();
  if (!caption) {
    throw new Error("content plan is missing a caption");
  }
  const allowed = new Set(allowedReferenceIds);
  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];
  if (rawShots.length !== maxShots) {
    throw new Error(
      `content plan returned ${rawShots.length} shot(s) for ${maxShots} requested shot(s)`,
    );
  }
  const shots = rawShots.map((shot, index) => {
    if (
      !isRecord(shot) ||
      typeof shot.scene !== "string" ||
      !shot.scene.trim()
    ) {
      throw new Error(`content plan shot ${index} is missing a scene`);
    }
    if (typeof shot.captureSetup !== "string" || !shot.captureSetup.trim()) {
      throw new Error(`content plan shot ${index} is missing captureSetup`);
    }
    if (typeof shot.characterVisible !== "boolean") {
      throw new Error(`content plan shot ${index} is missing characterVisible`);
    }
    if (shot.sortOrder !== index) {
      throw new Error(
        `content plan shot ${index} has invalid sortOrder ${String(shot.sortOrder)}`,
      );
    }
    const referenceIds = cleanReferenceIds(shot.referenceIds, allowed);
    assertVisibleCharacterHasReference(
      shot.characterVisible,
      referenceIds.length,
      `shot ${index}`,
    );
    if (!shot.characterVisible && referenceIds.length > 0) {
      throw new Error(
        `content plan shot ${index} cannot use character references when characterVisible is false`,
      );
    }
    return {
      sortOrder: index,
      scene: shot.scene.trim(),
      captureSetup: shot.captureSetup.trim(),
      characterVisible: shot.characterVisible,
      referenceIds: shot.characterVisible ? referenceIds : [],
    };
  });
  return {
    caption,
    hashtags: cleanHashtags(
      Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    ),
    shots,
  };
}

function cleanReferenceIds(values: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(values) || allowed.size === 0) {
    return [];
  }
  const cleaned: string[] = [];
  for (const value of values) {
    if (
      typeof value === "string" &&
      allowed.has(value) &&
      !cleaned.includes(value)
    ) {
      cleaned.push(value);
    }
    if (cleaned.length >= SHOT_REFERENCES_MAX) {
      break;
    }
  }
  return cleaned;
}

function cleanHashtags(values: unknown[]): string[] {
  const cleaned: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const tag = value.trim().replace(/^#+/, "").trim();
    if (tag && !cleaned.includes(tag)) {
      cleaned.push(tag);
    }
    if (cleaned.length >= HASHTAG_MAX) {
      break;
    }
  }
  return cleaned;
}

// OpenAI-compatible chat completions 응답에서 본문 텍스트를 꺼낸다.
// 캡셔닝(reference-captioner) 등 다른 LLM 호출도 재사용한다.
export function contentFromChatCompletion(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return null;
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return null;
  }
  const content = first.message.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
