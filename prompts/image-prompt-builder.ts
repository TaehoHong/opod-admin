// 이미지 프롬프트 빌더 LLM 프롬프트 — 한국어 컷 기획을 이미지 모델용 영어
// 프롬프트로 변환한다. fetch·파싱·오케스트레이션은
// src/worker/image-prompt-builder.ts에 있다.

export type ImagePromptBuilderPromptInput = {
  // 프롬프트 표현을 맞출 대상 fal.ai 모델 id (참고 정보, 없으면 미지정).
  targetModelId?: string;
  appearancePrompt: string;
  stylePrompt: string;
  // sortOrder 순의 한국어 컷 기획 서술.
  scenes: string[];
};

export const IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT = [
  "너는 이미지 생성 모델용 프롬프트 엔지니어다.",
  "캐릭터 외모·스타일 프롬프트와 컷별 한국어 장면 기획을 받아, 대상 모델에 최적화된 영어 이미지 프롬프트를 컷별로 1개씩 만든다.",
  "규칙:",
  "- 프롬프트는 영어로만 쓴다.",
  "- 외모 프롬프트의 정체성 요소는 모든 컷에서 동일하게 유지한다 (컷 간 인물 일관성).",
  "- 장면의 장소·구도·포즈·조명·분위기를 이미지 모델이 이해하는 구체적 시각 어휘로 옮긴다. 장면에 없는 사건·인물을 지어내지 않는다.",
  "- 스타일 프롬프트를 각 컷에 자연스럽게 반영한다.",
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
    `## 캐릭터 외모 프롬프트 (모든 컷 유지)\n${input.appearancePrompt.trim() || "(없음)"}`,
    `## 스타일 프롬프트 (모든 컷 반영)\n${input.stylePrompt.trim() || "(없음)"}`,
    `## 컷 장면 (한국어 기획)\n${input.scenes
      .map((scene, index) => `${index + 1}. ${scene}`)
      .join("\n")}`,
    `## 요청\n컷 ${input.scenes.length}개 각각의 영어 이미지 생성 프롬프트를 만들어라.`,
  ];
  return sections.join("\n\n");
}
