// 포스트 기획(content_plan) 단계. 페르소나·메모리·최근 캡션을 조립해 LLM에게
// 포스트 컨셉(캡션/해시태그/샷 리스트)을 구조화 출력으로 받는다.
// 프롬프트 텍스트는 prompts/content-planner.ts에서 관리한다.
// env(LLM_API_URL/LLM_API_KEY/LLM_MODEL, OpenAI-compatible chat completions)가
// 없으면 로컬 결정적 플래너로 대체된다 (개발/테스트용).

import {
  ContentPlanInput,
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserPrompt,
  clampShots,
} from "../../prompts/content-planner";

export type { ContentPlanInput } from "../../prompts/content-planner";

export type ContentPlan = {
  caption: string;
  hashtags: string[];
  // referenceIds: 카탈로그에서 고른 샷별 레퍼런스 (카탈로그 없으면 빈 배열).
  shots: { scene: string; referenceIds: string[] }[];
};

export type ContentPlanner = {
  readonly name: string;
  plan(input: ContentPlanInput): Promise<ContentPlan>;
};

const HTTP_TIMEOUT_MS = 60_000;
const HASHTAG_MAX = 5;
// 샷당 선별 레퍼런스 상한 — 앵커 2장과 합쳐도 프로바이더 한도(10)에 여유.
const SHOT_REFERENCES_MAX = 3;

type PlannerEnv = Record<string, string | undefined>;

// 플래너 구성 값 — 출처는 env 또는 admin_settings(DB)이며 이 계층은 출처를
// 모른다. 병합/우선순위는 GenerationSettingsService가 담당한다.
export type PlannerProviderSettings = {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
};

// 세 값이 모두 있어야 LLM 플래너, 하나라도 없으면 로컬 결정적 플래너.
export function resolveContentPlanner(
  settings: PlannerProviderSettings,
  fetchFn: typeof fetch = fetch,
): ContentPlanner {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  if (!apiUrl || !apiKey || !model) {
    return localContentPlanner;
  }
  return createLlmContentPlanner({ apiUrl, apiKey, model }, fetchFn);
}

// env 전용 진입점 (DB 설정 없이 쓰는 테스트/스크립트용).
export function createContentPlanner(
  env: PlannerEnv = process.env,
  fetchFn: typeof fetch = fetch,
): ContentPlanner {
  return resolveContentPlanner(
    {
      apiUrl: env.LLM_API_URL,
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
    },
    fetchFn,
  );
}

// 개발용 결정적 플래너. LLM 없이도 파이프라인 전 구간이 돈다.
export const localContentPlanner: ContentPlanner = {
  name: "local",
  plan(input) {
    const subject = input.sceneHint?.trim() || input.interests[0] || "일상";
    const maxShots = clampShots(input.maxShots);
    const shots = Array.from({ length: maxShots }, (_, index) => ({
      scene:
        index === 0
          ? `${subject}의 한 장면`
          : `${subject}의 다른 각도, 디테일 컷`,
      referenceIds: [] as string[],
    }));
    return Promise.resolve({
      caption: `${subject} 기록 — ${input.characterName}의 하루`,
      hashtags: cleanHashtags([
        ...input.interests.slice(0, HASHTAG_MAX - 1),
        "일상",
      ]),
      shots,
    });
  },
};

export function createLlmContentPlanner(
  config: { apiUrl: string; apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
): ContentPlanner {
  return {
    name: `llm:${config.model}`,
    async plan(input) {
      const response = await fetchFn(config.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: PLANNER_SYSTEM_PROMPT },
            { role: "user", content: buildPlannerUserPrompt(input) },
          ],
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
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
  const shots = (Array.isArray(parsed.shots) ? parsed.shots : [])
    .filter(
      (shot): shot is { scene: string; referenceIds?: unknown } =>
        isRecord(shot) &&
        typeof shot.scene === "string" &&
        Boolean(shot.scene.trim()),
    )
    .map((shot) => ({
      scene: shot.scene.trim(),
      referenceIds: cleanReferenceIds(shot.referenceIds, allowed),
    }))
    .slice(0, maxShots);
  if (shots.length === 0) {
    throw new Error("content plan has no usable shots");
  }
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
