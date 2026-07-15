// 이미지 프롬프트 빌드 단계. 기획(content_plan)이 만든 한국어 컷 장면을
// 캐릭터 외모·스타일과 합쳐 이미지 모델용 영어 프롬프트로 변환한다.
// draft당 1회 배치 호출로 컷 간 인물·스타일 일관성을 유지한다.
// 설정은 기획 LLM(planner.*)을 재사용하며(캡셔너·위저드 전례), 미설정이면
// 결정적 폴백(compileImagePrompt)으로 대체된다 — 기존 동작과 동일.
// 프롬프트 텍스트는 prompts/image-prompt-builder.ts에서 관리한다.

import { compileImagePrompt } from "../../prompts/image-prompt";
import {
  IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT,
  buildImagePromptBuilderUserPrompt,
} from "../../prompts/image-prompt-builder";
import {
  PlannerProviderSettings,
  contentFromChatCompletion,
} from "./content-planner";

const HTTP_TIMEOUT_MS = 60_000;

export type ImagePromptBuildInput = {
  appearancePrompt: string;
  stylePrompt: string;
  shots: { scene: string }[];
};

export type ImagePromptBuilder = {
  readonly name: string;
  build(input: ImagePromptBuildInput): Promise<{ prompts: string[] }>;
};

// 세 값이 모두 있어야 LLM 빌더, 하나라도 없으면 결정적 폴백.
export function resolveImagePromptBuilder(
  settings: PlannerProviderSettings,
  options: { targetModelId?: string } = {},
  fetchFn: typeof fetch = fetch,
): ImagePromptBuilder {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  if (!apiUrl || !apiKey || !model) {
    return localImagePromptBuilder;
  }
  return createLlmImagePromptBuilder(
    { apiUrl, apiKey, model, targetModelId: options.targetModelId },
    fetchFn,
  );
}

// 결정적 폴백 — LLM 없이 외모·장면·스타일 단순 연결 (기존 컴파일과 동일).
export const localImagePromptBuilder: ImagePromptBuilder = {
  name: "local",
  build(input) {
    return Promise.resolve({
      prompts: input.shots.map((shot) =>
        compileImagePrompt(
          {
            appearancePrompt: input.appearancePrompt,
            stylePrompt: input.stylePrompt,
          },
          shot.scene,
        ),
      ),
    });
  },
};

export function createLlmImagePromptBuilder(
  config: {
    apiUrl: string;
    apiKey: string;
    model: string;
    targetModelId?: string;
  },
  fetchFn: typeof fetch = fetch,
): ImagePromptBuilder {
  return {
    name: `llm:${config.model}`,
    async build(input) {
      const response = await fetchFn(config.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT },
            {
              role: "user",
              content: buildImagePromptBuilderUserPrompt({
                targetModelId: config.targetModelId,
                appearancePrompt: input.appearancePrompt,
                stylePrompt: input.stylePrompt,
                scenes: input.shots.map((shot) => shot.scene),
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`image prompt builder LLM failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("image prompt builder LLM returned no content");
      }
      return { prompts: parseBuiltImagePrompts(content, input.shots.length) };
    },
  };
}

// LLM 출력에서 컷별 프롬프트를 추출·검증한다 (마크다운 펜스 허용).
// 컷 수 불일치는 오류 — 조용히 잘리거나 밀리면 컷과 프롬프트가 어긋난다.
export function parseBuiltImagePrompts(
  raw: string,
  expectedCount: number,
): string[] {
  const text = raw.trim();
  const jsonText = text.startsWith("{")
    ? text
    : (text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("built image prompts are not valid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.shots)) {
    throw new Error("built image prompts are missing shots");
  }
  const prompts = parsed.shots.map((shot) =>
    isRecord(shot) && typeof shot.prompt === "string" ? shot.prompt.trim() : "",
  );
  if (prompts.length !== expectedCount) {
    throw new Error(
      `image prompt builder returned ${prompts.length} prompt(s) for ${expectedCount} shot(s)`,
    );
  }
  if (prompts.some((prompt) => !prompt)) {
    throw new Error("image prompt builder returned an empty prompt");
  }
  return prompts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
