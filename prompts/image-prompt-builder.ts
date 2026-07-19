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
    "- 하나로 흐르는 자연스러운 서술형 문장으로 쓴다 (콤마 키워드 나열보다 묘사가 낫다).",
    "- 가중치 문법 `(term:1.2)`나 품질 토큰(masterpiece, best quality 등)은 쓰지 않는다 — Flux는 무시하거나 역효과다.",
    "- 카메라 앵글·렌즈·조명·재질을 구체적인 문장으로 녹인다.",
  ].join("\n"),
  "nano-banana": [
    "- 사람에게 지시하듯 명확한 서술형 문장으로 쓴다 (지시-따르기형 모델).",
    "- 가중치 문법이나 품질 토큰은 쓰지 않는다.",
    "- 피사체·구도·조명·분위기를 구체적이고 모호하지 않게 지시한다.",
  ].join("\n"),
  "stable-diffusion": [
    "- 태그·키워드 나열형으로 쓴다 (콤마 구분): 핵심 피사체 → 구도 → 조명 → 스타일 → 품질 순.",
    "- 핵심 요소에만 가중치 문법 `(term:1.2)`를 절제해서 쓴다.",
    "- 앞부분에 품질 토큰(best quality, highly detailed, sharp focus 등)을 넣는다.",
  ].join("\n"),
  generic: [
    "- 구체적이고 명확한 서술형 문장으로 쓴다.",
    "- 특정 모델 전용 문법(가중치 등)은 피하고 범용적으로 쓴다.",
  ].join("\n"),
};

// 대상 모델에 맞는 계열별 작성 규칙 텍스트.
export function modelFamilyGuidance(modelId?: string): string {
  return MODEL_FAMILY_GUIDANCE[imageModelFamily(modelId)];
}

export const IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT = [
  "너는 이미지 생성 모델용 프롬프트 엔지니어다.",
  "캐릭터 외모·스타일 프롬프트와 컷별 한국어 장면 기획을 받아, 대상 모델에 최적화된 영어 이미지 프롬프트를 컷별로 1개씩 만든다.",
  "규칙:",
  "- 프롬프트는 영어로만 쓴다.",
  "- 외모 프롬프트의 정체성 요소는 모든 컷에서 동일하게 유지한다 (컷 간 인물 일관성).",
  "- 외모 프롬프트가 [라벨] 섹션으로 나뉘어 있으면, 각 컷에서 실제로 보이는 요소의 섹션만 반영한다 — 예: 뒷모습 컷에 얼굴·손톱 묘사 금지, 손 클로즈업 컷에 전신 체형 묘사 금지. 핵심 정체성 섹션은 인물이 보이면 항상 반영한다.",
  "- 장면의 장소·구도·포즈·조명·분위기를 이미지 모델이 이해하는 구체적 시각 어휘로 옮긴다. 장면에 없는 사건·인물을 지어내지 않는다.",
  "- 스타일 프롬프트를 각 컷에 자연스럽게 반영한다.",
  "- '대상 모델 표현 규칙' 섹션의 문법·형식을 반드시 따른다 — 모델 계열마다 프롬프트 작성법이 다르다.",
  "- 네거티브 프롬프트는 만들지 않는다 (별도 주입됨).",
  "- 컷 수는 입력과 정확히 같아야 하고 순서를 유지한다.",
  "반드시 아래 JSON만 출력한다 (설명·마크다운 금지):",
  '{"shots": [{"prompt": "..."}]}',
].join("\n");

export function buildImagePromptBuilderUserPrompt(
  input: ImagePromptBuilderPromptInput,
): string {
  const sections = [
    `## 대상 이미지 모델\n${input.targetModelId?.trim() || "(미지정)"}`,
    `## 대상 모델 표현 규칙\n${modelFamilyGuidance(input.targetModelId)}`,
    `## 캐릭터 외모 프롬프트\n${input.appearancePrompt.trim() || "(없음)"}`,
    `## 스타일 프롬프트 (모든 컷 반영)\n${input.stylePrompt.trim() || "(없음)"}`,
    `## 컷 장면 (한국어 기획)\n${input.scenes
      .map((scene, index) => `${index + 1}. ${scene}`)
      .join("\n")}`,
    `## 요청\n컷 ${input.scenes.length}개 각각의 영어 이미지 생성 프롬프트를 만들어라.`,
  ];
  return sections.join("\n\n");
}
