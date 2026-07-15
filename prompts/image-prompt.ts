// 결정적 이미지 프롬프트 템플릿 — 외모·장면·스타일을 단순 연결한다.
// LLM 프롬프트 빌더(image-prompt-builder)가 미설정일 때의 폴백이자,
// 비주얼 프로필 테스트 생성처럼 결정적 조립이 맞는 경로의 공용 함수.
export function compileImagePrompt(
  profile: { appearancePrompt: string; stylePrompt: string } | null,
  request: string,
): string {
  return [profile?.appearancePrompt ?? "", request, profile?.stylePrompt ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}
