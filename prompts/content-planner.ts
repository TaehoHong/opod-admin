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
  // 캐릭터 전용 + 범용 장소 카탈로그. 장소 레퍼런스는 인물 정체성이 아니라
  // 배경과 공간 일관성을 위한 조건 이미지다.
  locationCatalog?: {
    id: string;
    name: string;
    description: string;
    references: { id: string; description: string }[];
  }[];
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
  "- Write each shots.scene in Korean as a specific visual brief containing only what should be visible in the final image: setting, visible subjects, situation, composition, and mood. Do not describe an off-frame photographer or capture process in scene.",
  "- Write shots.captureSetup separately in Korean. It is production metadata describing who operates the camera, the physically reachable camera or phone position, height, direction, and capture method.",
  "- Set shots.characterVisible to true only when this character appears anywhere in the final frame, including a hand, reflection, silhouette, or partial body. Set it to false when the character remains entirely behind the camera and outside the frame.",
  "- If the personas or operator hint establish how the character takes photos, preserve that habit in captureSetup. Do not invent a photographer, tripod, or production crew that the character context does not establish.",
  "- Keep captureSetup, the visible hands, mirrors, phone, and physical action in scene mutually possible. Do not use a moving follow-camera, floating viewpoint, or professionally staged angle unless the established context calls for it.",
  "- References are identity conditioning. For each shot that shows the character, select 1-3 references that best preserve the identity features actually visible in the planned framing while respecting the character's face-visibility, cropping, and privacy rules. Prefer references whose direction and framing conflict least with the scene; clothing, background, and season are secondary. Use an empty array for shots without the character, such as objects or landscapes.",
  "- Locations are optional environment conditioning. Select one locationId for the whole post only when the planned post takes place at a listed location; otherwise use null. Never invent a location ID.",
  "- When locationId is selected, each shot may select 0-2 environmentReferenceIds from that location to preserve its layout, materials, lighting, and camera viewpoint. Environment references never count as character identity references.",
  "- Shots without the character must use an empty referenceIds array, but may still use environmentReferenceIds.",
  "- If no reference catalog is provided, plan only shots with characterVisible=false. Never invent a reference ID or plan a character-visible shot without an available identity reference.",
  "- Number shots with zero-based sortOrder in the exact output order.",
  "- Write the caption in the character's voice in 1-3 sentences.",
  "Return only the JSON below, with no explanation or Markdown:",
  '{"caption": "...", "hashtags": ["tag1", "tag2"], "locationId": null, "shots": [{"sortOrder": 0, "scene": "visible final-frame content only", "captureSetup": "off-frame capture method and camera geometry", "characterVisible": true, "referenceIds": ["identity-id1"], "environmentReferenceIds": ["environment-id1"]}]}',
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
  if ((input.locationCatalog ?? []).length > 0) {
    sections.push(
      `## Available locations (optional; environment references are not identity references)\n${input
        .locationCatalog!.map(
          (location) =>
            `### [${location.id}] ${location.name}\n${location.description}\n${location.references
              .map(
                (reference) =>
                  `- [${reference.id}] ${reference.description || "(no description)"}`,
              )
              .join("\n") || "- (no usable environment references)"}`,
        )
        .join("\n")}`,
    );
  }
  sections.push(
    `## Request\nPlan one feed post with ${clampShots(input.maxShots)} image shots.`,
  );
  return sections.join("\n\n");
}
