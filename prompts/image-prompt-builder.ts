// 이미지 프롬프트 빌더 LLM 프롬프트 — 한국어 컷 기획을 이미지 모델용 영어
// 프롬프트로 변환한다. fetch·파싱·오케스트레이션은
// src/worker/image-prompt-builder.ts에 있다.

export type ImagePromptBuilderPromptInput = {
  // 프롬프트 표현을 맞출 대상 fal.ai 모델 id (없으면 미지정 → generic).
  targetModelId?: string;
  appearancePrompt: string;
  stylePrompt: string;
  // sortOrder 순의 한국어 컷 기획 서술.
  scenes: string[];
};

// 프롬프트 문법이 다른 이미지 모델 계열. 같은 계열은 프롬프트 작성법이 같다.
export type ImageModelFamily =
  "flux" | "nano-banana" | "stable-diffusion" | "generic";

// fal 모델 id를 계열로 분류한다. 프로바이더의 falSupportsNegativePrompt와
// 같은 판별 축(stable-diffusion|sdxl|sd3)을 공유한다.
export function imageModelFamily(modelId?: string): ImageModelFamily {
  const id = (modelId ?? "").toLowerCase();
  if (!id) {
    return "generic";
  }
  if (/stable-diffusion|sdxl|sd3/.test(id)) {
    return "stable-diffusion";
  }
  if (/flux/.test(id)) {
    return "flux";
  }
  if (/nano-banana|gemini|imagen/.test(id)) {
    return "nano-banana";
  }
  return "generic";
}

// 계열별 프롬프트 작성 규칙 — 문법·형식이 계열마다 다르다.
const MODEL_FAMILY_GUIDANCE: Record<ImageModelFamily, string> = {
  flux: [
    "- Write a single, natural descriptive passage; prose works better than a comma-separated keyword list.",
    "- Do not use weighting syntax such as `(term:1.2)` or quality tokens such as masterpiece or best quality; Flux ignores them or may respond poorly.",
    "- Describe the camera angle, lens, lighting, and materials in specific language.",
  ].join("\n"),
  "nano-banana": [
    "- Use clear descriptive instructions as if directing a person; this model follows instructions.",
    "- Do not use weighting syntax or quality tokens.",
    "- Specify the subject, composition, lighting, and mood concretely and without ambiguity.",
  ].join("\n"),
  "stable-diffusion": [
    "- Use a comma-separated tag and keyword list ordered as: primary subject, composition, lighting, style, quality.",
    "- Use weighting syntax such as `(term:1.2)` sparingly and only for essential elements.",
    "- Put quality tokens such as best quality, highly detailed, and sharp focus near the beginning.",
  ].join("\n"),
  generic: [
    "- Use specific, clear descriptive language.",
    "- Keep the prompt model-agnostic and avoid model-specific syntax such as weighting.",
  ].join("\n"),
};

// 대상 모델에 맞는 계열별 작성 규칙 텍스트.
export function modelFamilyGuidance(modelId?: string): string {
  return MODEL_FAMILY_GUIDANCE[imageModelFamily(modelId)];
}

export const IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT = [
  "You are a prompt engineer for image-generation models.",
  "Given a character appearance prompt, a style prompt, and a Korean scene plan for each shot, create one English image prompt per shot optimized for the target model.",
  "Rules:",
  "- Write every prompt in English only.",
  "- Preserve the appearance prompt's identity-defining details across all shots to maintain character consistency.",
  "- If the appearance prompt is divided into [labeled] sections, include only sections for features actually visible in each shot. For example, omit face and nail details in a rear-view shot and omit full-body proportions in a hand close-up. Always include core identity sections whenever the character is visible.",
  "- Translate the scene's location, composition, pose, lighting, and mood into concrete visual language the image model understands. Do not invent events or people absent from the scene.",
  "- Incorporate the style prompt naturally into every shot.",
  "- Follow the syntax and format in the 'Target model guidance' section exactly; prompt-writing conventions differ by model family.",
  "- Do not create a negative prompt; it is injected separately.",
  "- Return exactly as many shots as the input, in the same order.",
  "Return only the JSON below, with no explanation or Markdown:",
  '{"shots": [{"prompt": "..."}]}',
].join("\n");

export function buildImagePromptBuilderUserPrompt(
  input: ImagePromptBuilderPromptInput,
): string {
  const sections = [
    `## Target image model\n${input.targetModelId?.trim() || "(unspecified)"}`,
    `## Target model guidance\n${modelFamilyGuidance(input.targetModelId)}`,
    `## Character appearance prompt\n${input.appearancePrompt.trim() || "(none)"}`,
    `## Style prompt (apply to every shot)\n${input.stylePrompt.trim() || "(none)"}`,
    `## Shot scenes (Korean plan)\n${input.scenes
      .map((scene, index) => `${index + 1}. ${scene}`)
      .join("\n")}`,
    `## Request\nCreate one English image-generation prompt for each of the ${input.scenes.length} shots.`,
  ];
  return sections.join("\n\n");
}
