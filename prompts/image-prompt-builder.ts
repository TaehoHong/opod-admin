// 이미지 프롬프트 빌더 LLM 프롬프트 — 한국어 컷 기획을 이미지 모델용 영어
// 프롬프트로 변환한다. fetch·파싱·오케스트레이션은
// src/worker/image-prompt-builder.ts에 있다.

export type ImagePromptBuilderPromptInput = {
  appearancePrompt: string;
  stylePrompt: string;
  environmentPrompt?: string;
  // sortOrder 순의 구조화된 한국어 컷 기획.
  shots: {
    sortOrder: number;
    scene: string;
    captureSetup: string;
    characterVisible: boolean;
    // 실제 이 샷이 실행될 fal.ai 모델 id (없으면 generic).
    targetModelId?: string;
  }[];
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
    '- For an edit model with attached reference images, begin the generated prompt with this exact instruction: "Use the attached reference images only to preserve this same person\'s identity, hair, skin tone, and natural body proportions. Ignore their pose, crop, clothing, background, phone, and camera geometry; follow the written final-frame instructions instead."',
    "- Treat phones, cameras, carried objects, operating hands, and occluding poses in attached references as non-identity artifacts. When the final-frame scene omits them, explicitly reconstruct relaxed empty hands and unobstructed clothing instead of retaining those artifacts.",
    "- Express a requested crop as a hard frame boundary with positive frame-edge landmarks before any exclusions. For a below-neck-to-mid-thigh crop, say that the top image edge crosses the base of the neck above the collarbones and the bottom edge crosses mid-thigh, so only the body between those edges is visible; keep the remaining exclusion list short.",
    "- When a phone must fully hide a face, define the physical occlusion: the opaque phone-and-hand silhouette extends from the hairline through below the chin and across both cheeks, covering the forehead, eyes, nose, mouth, and chin with no identifiable facial feature visible.",
    "- When a tight crop excludes the head or face and the scene does not explicitly show the phone, keep the phone, operating hand, forearm, chin, face, and hair completely above the top frame edge. Do not move a selfie phone down into the torso crop merely to make the capture method visible.",
    "- For a multi-shot set, lock one exact wardrobe construction before writing the shots: garment type, neckline, strap shape and width, underbust band, seam placement, waistband height, material, and color. Repeat that construction word-for-word in every shot where it is visible, and explicitly forbid alternate cuts, necklines, straps, seams, or redesigns.",
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
  "- Resolve conflicts in this order: final-frame content and character visibility, capture setup and physical feasibility, visible character identity, situation and mood, then global style defaults.",
  "- scene contains only what belongs in the final pixels. captureSetup is camera-geometry metadata and is not itself a list of subjects to render.",
  "- Never depict an off-frame photographer, their hands or body, or their camera merely because captureSetup names them. Express captureSetup through the reachable viewpoint and composition.",
  "- When characterVisible is false, do not include the character appearance or turn the photographer into a visible subject. When true, preserve the supplied appearance details that are actually visible.",
  "- If the appearance prompt is divided into [labeled] sections, include only sections for features actually visible in each shot. For example, omit face and nail details in a rear-view shot and omit full-body proportions in a hand close-up. Always include core identity sections whenever the character is visible.",
  "- Never invent or intensify age, bust, waist, hip, leg, or other anatomy details beyond the supplied appearance and final-frame scene. Preserve the identity reference's natural proportions; do not reshape or exaggerate the body for aesthetics.",
  "- Treat identity references as identity and proportion evidence only. Do not copy their studio background, pose, crop, lighting, or clothing when those conflict with the planned scene.",
  '- For a reference-edit target, include this reference-role rule verbatim in the final image prompt itself; do not merely use it as private writing guidance: "Use the attached reference images only to preserve this same person\'s identity, hair, skin tone, and natural body proportions. Ignore their pose, crop, clothing, background, phone, and camera geometry; follow the written final-frame instructions instead."',
  "- Phones, cameras, carried objects, operating hands, and occluding poses in identity references are not identity evidence. If the final-frame scene does not explicitly require one, state the positive replacement—relaxed empty hands, arms in the planned pose, and unobstructed clothing—and omit the reference artifact entirely.",
  "- When a shot intentionally crops out a feature, write a non-negotiable frame-boundary instruction using positive top-edge and bottom-edge landmarks before a short exclusion clause. Do not rely on a long negative list or soften the boundary into mood prose.",
  "- When the plan says a phone fully covers the face, translate that into physical coverage landmarks in the final prompt: the opaque phone-and-hand silhouette must extend from the hairline through below the chin and across both cheeks, covering the forehead, eyes, nose, mouth, and chin with no identifiable facial feature visible.",
  "- When the final-frame scene crops out the head or face and does not explicitly include the phone, keep the phone, operating hand, forearm, chin, face, and hair completely above the top image edge. Capture metadata may explain a selfie viewpoint, but it must not cause an excluded phone or hand to be rendered inside the torso crop.",
  "- Before writing a multi-shot set, derive one locked wardrobe construction from the plan and repeat it word-for-word in every prompt where the garment is visible. Include garment type, neckline, strap shape and width, underbust band, seam placement, waistband height, material, and color; explicitly forbid alternate cuts, necklines, straps, seams, or redesigns.",
  "- Preserve the captureSetup's phone or camera placement, mirror relationship, framing, and lighting as a physically reachable viewpoint. Keep visible hands consistent with the action, and do not invent a moving follow-camera or additional people.",
  "- Translate the scene's location, composition, pose, lighting, and mood into concrete visual language the image model understands. Allow natural occlusion when framing or action hides an appearance feature; do not reposition hair, body, or clothing merely to expose it.",
  "- When an environment prompt is supplied, preserve its fixed architecture, materials, palette, fixtures, and lighting across every shot. Treat it as the canonical location, not as optional decoration.",
  "- Across shots in one post, keep invariant facts literally consistent: exact outfit construction and color, hairstyle and body proportions, phone orientation and device appearance, location architecture, mirror frame, time of day, and light direction. Change only the pose, action, or crop explicitly changed by the shot plan.",
  "- Keep location wording limited to details that can change the visible pixels. Omit relational filler such as 'same', exact floor area, opening hours, and district or city names unless the scene explicitly requires visible signage or a recognizable landmark. Convert useful facts into visual attributes instead; for example, write 'a spacious gym lined with strength-training machines', not 'the same large 450-pyeong 24-hour machine-focused gym in Buldang-dong, Cheonan'.",
  "- Treat the style prompt as a visual default. Incorporate only the parts that do not conflict with the scene's capture setup, time, lighting, composition, or physical action.",
  "- Follow the syntax and format in the 'Target model guidance' section exactly; prompt-writing conventions differ by model family.",
  "- Do not create a negative prompt; it is injected separately.",
  "- Return exactly as many shots as the input, in the same order.",
  "Return only the JSON below, with no explanation or Markdown:",
  '{"shots": [{"sortOrder": 0, "prompt": "..."}]}',
].join("\n");

export function buildImagePromptBuilderUserPrompt(
  input: ImagePromptBuilderPromptInput,
): string {
  const appearance = input.appearancePrompt.trim() || "(none)";
  const shots = input.shots
    .map((shot) =>
      [
        `### Shot ${shot.sortOrder}`,
        `Target image model: ${shot.targetModelId?.trim() || "(unspecified)"}`,
        `Target model guidance:\n${modelFamilyGuidance(shot.targetModelId)}`,
        `Final-frame scene: ${shot.scene}`,
        `Capture setup (viewpoint metadata, not extra subjects): ${shot.captureSetup}`,
        `Character visible in final frame: ${shot.characterVisible ? "yes" : "no"}`,
        `Appearance to use in this shot: ${shot.characterVisible ? appearance : "(none)"}`,
      ].join("\n"),
    )
    .join("\n\n");
  const sections = [
    `## Style defaults (apply only when compatible with the shot)\n${input.stylePrompt.trim() || "(none)"}`,
    `## Canonical environment (apply to every shot)\n${input.environmentPrompt?.trim() || "(none)"}`,
    `## Shot plans\n${shots}`,
    `## Request\nCreate one English image-generation prompt for each of the ${input.shots.length} shots.`,
  ];
  return sections.join("\n\n");
}
