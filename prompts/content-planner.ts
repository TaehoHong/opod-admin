// 기획 LLM 프롬프트 — 시스템 규칙과 유저 프롬프트 조립만 담당한다.
// fetch·파싱·오케스트레이션은 src/worker/content-planner.ts에 있다.
// LLM 프롬프트 상수·순수 조립 함수는 전부 이 prompts/ 폴더에서 관리한다.

export type ContentPlanInput = {
  characterName: string;
  bio: string;
  interests: string[];
  // sortOrder 순으로 정렬된 활성 페르소나.
  personas: { title: string; content: string }[];
  memories: string[];
  // 소재 중복 방지용 최근 게시 캡션.
  recentCaptions: string[];
  // 수동 draft 생성 시 운영자가 준 장면 힌트.
  sceneHint?: string;
  maxShots?: number;
  // 레퍼런스 이미지 카탈로그 (캡션 있는 것만). LLM이 샷별로 어울리는
  // 레퍼런스를 고른다 — docs/media-generation-pipeline.md "컨텍스트 선별".
  referenceCatalog?: { id: string; description: string }[];
};

const DEFAULT_MAX_SHOTS = 2;
const SHOTS_HARD_CAP = 3;

export function clampShots(value: number | undefined): number {
  if (!value || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_SHOTS;
  }
  return Math.min(value, SHOTS_HARD_CAP);
}

export const PLANNER_SYSTEM_PROMPT = [
  "너는 AI 버추얼 인플루언서의 SNS 콘텐츠 기획자다.",
  "캐릭터 정보를 바탕으로 인스타그램 스타일 피드 포스트 1건을 기획한다.",
  "규칙:",
  "- 캐릭터의 확정 세계관(메모리)과 모순되는 장소·시점·사건을 만들지 않는다.",
  "- 최근 게시물과 소재가 겹치지 않게 한다.",
  "- shots의 scene은 장면·상황·분위기가 구체적으로 드러나는 한국어 편집 기획 서술로 쓴다. 이미지 모델 프롬프트 문법이나 인물 외모 묘사는 쓰지 않는다 (별도 단계에서 처리).",
  "- 레퍼런스 카탈로그가 주어지면, 각 shot에 그 장면(구도·포즈·의상·분위기)과 어울리는 이미지 id를 최대 3개 고른다. 어울리는 것이 없으면 빈 배열.",
  "- 캡션은 캐릭터의 말투로, 1~3문장.",
  "반드시 아래 JSON만 출력한다 (설명·마크다운 금지):",
  '{"caption": "...", "hashtags": ["태그1", "태그2"], "shots": [{"scene": "...", "referenceIds": ["id1"]}]}',
].join("\n");

export function buildPlannerUserPrompt(input: ContentPlanInput): string {
  const sections = [
    `## 캐릭터\n이름: ${input.characterName}\n소개: ${input.bio}\n관심사: ${input.interests.join(", ") || "(없음)"}`,
  ];
  if (input.personas.length > 0) {
    sections.push(
      `## 페르소나\n${input.personas
        .map((persona) => `### ${persona.title}\n${persona.content}`)
        .join("\n")}`,
    );
  }
  if (input.memories.length > 0) {
    sections.push(
      `## 확정 세계관/메모리 (모순 금지)\n${input.memories
        .slice(0, 20)
        .map((memory) => `- ${memory}`)
        .join("\n")}`,
    );
  }
  if (input.recentCaptions.length > 0) {
    sections.push(
      `## 최근 게시물 캡션 (소재 중복 금지)\n${input.recentCaptions
        .slice(0, 20)
        .map((caption) => `- ${caption}`)
        .join("\n")}`,
    );
  }
  if (input.sceneHint?.trim()) {
    sections.push(`## 운영자 장면 힌트 (반영 필수)\n${input.sceneHint.trim()}`);
  }
  if ((input.referenceCatalog ?? []).length > 0) {
    sections.push(
      `## 레퍼런스 카탈로그 (shot별로 어울리는 id 선택)\n${input
        .referenceCatalog!.map(
          (reference) => `- [${reference.id}] ${reference.description}`,
        )
        .join("\n")}`,
    );
  }
  sections.push(
    `## 요청\n샷(이미지 컷) ${clampShots(input.maxShots)}개짜리 피드 포스트 1건을 기획하라.`,
  );
  return sections.join("\n\n");
}
