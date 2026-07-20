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
  "You are a social media content planner for an AI virtual influencer.",
  "Plan one Instagram-style feed post based on the character information.",
  "Rules:",
  "- Do not invent places, times, or events that contradict the character's established world and memories.",
  "- Avoid topics used in recent posts.",
  "- Write each shots.scene in Korean as a specific editorial brief describing the setting, situation, and mood. Do not use image-model prompt syntax or describe the character's appearance; those are handled separately.",
  "- References are for character identity, especially the face and hair. For each shot that shows the character, select 1-3 reference IDs where the face is clearly visible. Do not reject a reference solely because its clothing, background, or season differs from the scene; when several work, prefer those that conflict least with the scene. Use an empty array for shots without the character, such as objects or landscapes.",
  "- Write the caption in the character's voice in 1-3 sentences.",
  "Return only the JSON below, with no explanation or Markdown:",
  '{"caption": "...", "hashtags": ["tag1", "tag2"], "shots": [{"scene": "...", "referenceIds": ["id1"]}]}',
].join("\n");

export function buildPlannerUserPrompt(input: ContentPlanInput): string {
  const sections = [
    `## Character\nName: ${input.characterName}\nBio: ${input.bio}\nInterests: ${input.interests.join(", ") || "(none)"}`,
  ];
  if (input.personas.length > 0) {
    sections.push(
      `## Personas\n${input.personas
        .map((persona) => `### ${persona.title}\n${persona.content}`)
        .join("\n")}`,
    );
  }
  if (input.memories.length > 0) {
    sections.push(
      `## Established world and memories (do not contradict)\n${input.memories
        .slice(0, 20)
        .map((memory) => `- ${memory}`)
        .join("\n")}`,
    );
  }
  if (input.recentCaptions.length > 0) {
    sections.push(
      `## Recent post captions (avoid repeating topics)\n${input.recentCaptions
        .slice(0, 20)
        .map((caption) => `- ${caption}`)
        .join("\n")}`,
    );
  }
  if (input.sceneHint?.trim()) {
    sections.push(
      `## Operator scene hint (required)\n${input.sceneHint.trim()}`,
    );
  }
  if ((input.referenceCatalog ?? []).length > 0) {
    sections.push(
      `## Reference catalog (for identity in character shots; follow the rules above)\n${input
        .referenceCatalog!.map(
          (reference) => `- [${reference.id}] ${reference.description}`,
        )
        .join("\n")}`,
    );
  }
  sections.push(
    `## Request\nPlan one feed post with ${clampShots(input.maxShots)} image shots.`,
  );
  return sections.join("\n\n");
}
