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
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";

const HTTP_TIMEOUT_MS = 60_000;

export type ImagePromptBuildInput = {
  appearancePrompt: string;
  stylePrompt: string;
  environmentPrompt?: string;
  shots: {
    sortOrder: number;
    scene: string;
    captureSetup: string;
    characterVisible: boolean;
    targetModelId?: string;
  }[];
};

export type ImagePromptBuilder = {
  readonly name: string;
  readonly targetModelIds?: {
    t2i?: string;
    edit?: string;
  };
  build(
    input: ImagePromptBuildInput,
    context?: LlmLogContext,
  ): Promise<{ prompts: string[] }>;
};

// 세 값이 모두 있어야 LLM 빌더, 하나라도 없으면 결정적 폴백.
export function resolveImagePromptBuilder(
  settings: PlannerProviderSettings,
  options: {
    t2iModelId?: string;
    editModelId?: string;
  } = {},
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ImagePromptBuilder {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  const targetModelIds = {
    ...(options.t2iModelId?.trim() ? { t2i: options.t2iModelId.trim() } : {}),
    ...(options.editModelId?.trim()
      ? { edit: options.editModelId.trim() }
      : {}),
  };
  if (!apiUrl || !apiKey || !model) {
    return {
      ...localImagePromptBuilder,
      ...(Object.keys(targetModelIds).length > 0 ? { targetModelIds } : {}),
    };
  }
  return createLlmImagePromptBuilder(
    { apiUrl, apiKey, model, targetModelIds },
    fetchFn,
    llmLogs,
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
            appearancePrompt: shot.characterVisible
              ? input.appearancePrompt
              : "",
            stylePrompt: input.stylePrompt,
          },
          [
            input.environmentPrompt?.trim()
              ? `Canonical environment: ${input.environmentPrompt.trim()}`
              : "",
            `Final image content: ${shot.scene}`,
            shot.characterVisible
              ? "Use a physically plausible camera viewpoint consistent with the final-frame scene; do not add any off-frame photographer or capture equipment"
              : "Use a physically plausible camera viewpoint consistent with the final-frame scene; the character, photographer, hands, body, and capture equipment remain entirely outside the frame",
          ].filter(Boolean).join(". "),
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
    targetModelIds?: {
      t2i?: string;
      edit?: string;
    };
  },
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ImagePromptBuilder {
  return {
    name: `llm:${config.model}`,
    ...(config.targetModelIds ? { targetModelIds: config.targetModelIds } : {}),
    async build(input, context) {
      const requestJson = {
        model: config.model,
        messages: [
          { role: "system", content: IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildImagePromptBuilderUserPrompt({
              appearancePrompt: input.appearancePrompt,
              stylePrompt: input.stylePrompt,
              environmentPrompt: input.environmentPrompt,
              shots: input.shots,
            }),
          },
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
            type: LLM_LOG_TYPE.imagePromptBuild,
            provider: "openai-compatible",
            model: config.model,
            endpoint: config.apiUrl,
            requestJson,
            context,
            execute,
          })
        : await execute();
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

export function targetModelIdForShot(
  builder: ImagePromptBuilder,
  usesReferences: boolean,
): string | undefined {
  return usesReferences
    ? builder.targetModelIds?.edit
    : builder.targetModelIds?.t2i;
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
  const prompts = parsed.shots.map((shot, index) => {
    if (!isRecord(shot) || shot.sortOrder !== index) {
      throw new Error(
        `image prompt builder shot ${index} has invalid sortOrder`,
      );
    }
    return typeof shot.prompt === "string" ? shot.prompt.trim() : "";
  });
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
