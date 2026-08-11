export const IMAGE_EVAL_DIMENSIONS = [
  "plan_fidelity",
  "capture_fidelity",
  "identity_preservation",
  "outfit_continuity",
  "environment_continuity",
  "photorealism",
  "artifact_free",
] as const;

export type ImageEvalDimension = (typeof IMAGE_EVAL_DIMENSIONS)[number];

export const IMAGE_EVAL_HARD_FAILURES = [
  "face_visibility_mismatch",
  "crop_or_pose_mismatch",
  "phone_orientation_mismatch",
  "outfit_changed",
  "identity_or_body_proportion_drift",
  "environment_changed",
  "reflection_or_hand_physics_error",
  "severe_ai_artifact",
  "cross_shot_continuity_break",
] as const;

export type ImageEvalHardFailure = (typeof IMAGE_EVAL_HARD_FAILURES)[number];

export type ImageEvaluationMedia = {
  mediaId: string;
  url: string;
  storageKey?: string | null;
  contentType?: string | null;
};

export type ImageEvaluationPromptInput = {
  caption: string;
  shots: {
    sortOrder: number;
    scene: string;
    captureSetup: string;
    prompt: string;
    identityReferences: ImageEvaluationMedia[];
    environmentReferences: ImageEvaluationMedia[];
    candidates: (ImageEvaluationMedia & { candidateIndex: number })[];
  }[];
};

export const IMAGE_EVALUATOR_SYSTEM_PROMPT = [
  "You are a strict visual quality gate for generated social-media images.",
  "Judge the actual candidate pixels against the Korean shot plan, capture setup, final generation prompt, identity references, and environment references.",
  "Evaluate every candidate independently on these dimensions:",
  "- plan_fidelity: visible scene, subject, pose, crop, mood, and required objects match the plan without invention.",
  "- capture_fidelity: mirror/selfie/camera logic, phone orientation, face visibility, hand use, reflection, and viewpoint match the planned capture.",
  "- identity_preservation: visible identity, hair, skin tone, and natural body proportions are preserved from identity references without reshaping or exaggeration.",
  "- outfit_continuity: garment type, neckline, straps, seams, color, socks, shoes, and accessories match the plan and related shots.",
  "- environment_continuity: room, architecture, mirror frame, floor, fixtures, light direction, and time of day match environment references and related shots.",
  "- photorealism: ordinary smartphone-photo texture, natural skin and fabric, believable light, and non-catalog imperfection.",
  "- artifact_free: hands, fingers, phone, anatomy, reflections, edges, fabric, and background contain no visible generation defects.",
  "Strict scoring:",
  "- 5: publication-ready with no visible issue or suggestion.",
  "- 4: one cosmetic flaw that does not change identity, content, or continuity.",
  "- 3: usable only after a concrete edit; any issue or suggestion caps the affected dimension at 3.",
  "- 2: reject and regenerate; the visible result is materially wrong.",
  "- 1: unusable or severely contradictory.",
  "Record every applicable hard failure using only these codes:",
  IMAGE_EVAL_HARD_FAILURES.join(", "),
  "A hard failure is mandatory when the planned face visibility/crop, pose, phone orientation, outfit construction, natural identity/body proportions, environment, reflection/hand physics, or basic realism is materially wrong.",
  "A candidate passes only when it has no hard failure and no dimension at 1 or 2.",
  "After candidate scoring, select one candidate index per shot that forms the most coherent post. Judge cross-shot consistency for exact outfit, hair/body proportions, phone/device, room/mirror, time, and lighting. If no coherent set exists, include cross_shot_continuity_break.",
  "Do not infer quality from the written prompt. The pixels are authoritative.",
  "Write reasons, issues, and suggestions in Korean. Return only JSON with no Markdown:",
  '{"shots":[{"sortOrder":0,"candidates":[{"candidateIndex":0,"scores":{"plan_fidelity":{"score":3,"reason":"..."},"capture_fidelity":{"score":2,"reason":"..."},"identity_preservation":{"score":3,"reason":"..."},"outfit_continuity":{"score":2,"reason":"..."},"environment_continuity":{"score":4,"reason":"..."},"photorealism":{"score":3,"reason":"..."},"artifact_free":{"score":4,"reason":"..."}},"hardFailures":["phone_orientation_mismatch"],"issues":["..."],"suggestions":["..."]}]}],"crossShot":{"score":2,"selectedCandidates":[{"sortOrder":0,"candidateIndex":0}],"hardFailures":["cross_shot_continuity_break"],"issues":["..."]}}',
].join("\n");

export function buildImageEvaluatorUserPrompt(
  input: ImageEvaluationPromptInput,
): string {
  const shots = input.shots
    .map((shot) =>
      [
        `### Shot ${shot.sortOrder}`,
        `Korean scene: ${shot.scene}`,
        `Korean capture setup: ${shot.captureSetup}`,
        `Generation prompt: ${shot.prompt}`,
        `Identity reference labels: ${shot.identityReferences.map((item) => item.mediaId).join(", ") || "(none)"}`,
        `Environment reference labels: ${shot.environmentReferences.map((item) => item.mediaId).join(", ") || "(none)"}`,
        `Candidate indexes: ${shot.candidates.map((item) => item.candidateIndex).join(", ")}`,
      ].join("\n"),
    )
    .join("\n\n");
  return [
    `## Post caption\n${input.caption}`,
    `## Shot contracts\n${shots}`,
    "## Image order",
    "Images follow this text in shot order. Each image is preceded by a text label identifying its shot, role, media id, and candidate index.",
    "## Request",
    "Evaluate every candidate, choose the best cross-shot set, and return the required JSON verdict.",
  ].join("\n\n");
}
