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
  "- Match references shot by shot, not once for the whole post. When the catalog describes a reference with the requested crop, view direction, or face visibility, select that reference for the matching shot instead of a conflicting full-body or face-visible reference.",
  "- When multiple character shots must preserve the same person, outfit, and location, select one suitable shared reference as the first identity-and-wardrobe anchor in every character shot, then add at most one shot-specific framing reference only when it does not contradict the shared anchor. Never select a reference whose description marks it as analysis-only, failed, unsuitable, or says not to use it.",
  "- Prefer a neutral, unobstructed, accessory-free shared anchor: a clear body and wardrobe silhouette, empty hands, and no phone, camera, carried prop, or pose that hides the visible garment. If an object such as a phone appears in only some requested shots, use the clean anchor for every shot and add that object only to the shots that require it. Do not choose a contaminated reference merely because its description calls it a shared anchor; removing a repeated device or occlusion is less reliable than adding the device to one explicit shot.",
  "- When several neutral references preserve identity, prefer as the first shared anchor the one whose visible wardrobe, background palette, and light most closely match the requested final pixels, even when its crop is narrower. Add a second shot-specific geometry reference only when needed; do not put a conflicting full-body studio image first merely because it covers more of the body.",
  "- When the operator requests the same outfit across multiple shots, define one concrete visible wardrobe construction and repeat the same wording in every shots.scene where it appears. If the selected reference descriptions consistently specify a matching garment detail such as neckline or strap shape, use that evidence and do not invent a conflicting construction. Do not copy unrelated reference clothing when the operator specified different clothing.",
  "- For a tight crop that excludes the head or face, keep a selfie phone and its operating hand completely above the top frame edge unless the operator explicitly requires them in the final pixels. Describe the crop as distance, zoom, or framing in captureSetup; never lower the phone into the visible torso crop merely to explain how the image was taken.",
  "- If the final frame must exclude the head, face, neck, and hair, do not place the top frame edge at the collarbones or shoulders, where those excluded features can leak into the image. Use a boundary clearly inside the visible torso and keep any explicitly required arms or empty hands visible.",
  "- For Nano Banana-style edit generation, prefer a torso crop whose top edge visibly cuts through the upper garment cups below the shoulders when the goal is simply to remove the head, face, neck, and hair. This model may retain the whole top when asked to begin below an underband, so do not demand a lower boundary unless hiding the entire top is essential.",
  "- A normal handheld smartphone is not a reliable hard-privacy mask for the complete vertical face. If zero facial skin is mandatory, prefer a top-frame crop that removes the head and use a fixed self-timer capture. Use phone occlusion only when partial lower-face visibility is acceptable or the operator explicitly requires it despite this tradeoff.",
  "- If the final scene requires both hands empty and no phone or operating hand visible, captureSetup must use a fixed phone with a self-timer on an established reachable surface. Never call that shot handheld or a handheld mirror selfie.",
  "- Treat every explicit operator exclusion as a hard final-frame constraint. Do not reintroduce an excluded head, face, chin, hair, hand, arm, phone, or prop from the appearance profile, style defaults, or a reference description. Distinguish those exclusions from body parts the operator explicitly requires to remain visible.",
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
            `### [${location.id}] ${location.name}\n${location.description}\n${
              location.references
                .map(
                  (reference) =>
                    `- [${reference.id}] ${reference.description || "(no description)"}`,
                )
                .join("\n") || "- (no usable environment references)"
            }`,
        )
        .join("\n")}`,
    );
  }
  sections.push(
    `## Request\nPlan one feed post with ${clampShots(input.maxShots)} image shots.`,
  );
  return sections.join("\n\n");
}
