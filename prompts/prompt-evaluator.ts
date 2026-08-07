// 이미지 프롬프트 평가 LLM 프롬프트 — 빌드된 컷별 영어 프롬프트를 6차원으로
// 배치 심사한다 (Layer 2). 정적 린트(Layer 1)는 src/worker/prompt-lint.ts.
// fetch·파싱·오케스트레이션은 src/worker/prompt-evaluator.ts에 있다.
// docs/image-prompt-evaluation-agent.md 3절.

import { modelFamilyGuidance } from "./image-prompt-builder";

export const PROMPT_EVAL_SHOT_DIMENSIONS = [
  "scene_capture_separation",
  "physical_consistency",
  "model_family_rules",
  "plan_fidelity",
  "reference_alignment",
] as const;

export type PromptEvalShotDimension =
  (typeof PROMPT_EVAL_SHOT_DIMENSIONS)[number];

export type PromptEvaluationPromptInput = {
  planCaption: string;
  shots: {
    sortOrder: number;
    scene: string;
    captureSetup: string;
    characterVisible: boolean;
    targetModelId?: string;
    prompt: string;
    // Layer 1 정적 린트가 이미 찾은 위반 — 심사 참고 정보로만 전달한다.
    lintIssues: string[];
  }[];
};

export const PROMPT_EVALUATOR_SYSTEM_PROMPT = [
  "You are a strict quality judge for image-generation prompts built from Korean shot plans.",
  "For each shot, compare the built English prompt against its Korean plan and score these dimensions:",
  "- scene_capture_separation: the prompt renders only final-frame content; capture setup appears only as viewpoint/composition, never as an extra visible subject (no off-frame photographer, their hands, or their camera rendered).",
  "- physical_consistency: camera position, mirrors, visible hands, and actions are physically compatible (e.g. a mirror selfie must show the phone; a two-hands-busy action cannot also hold the camera).",
  "- model_family_rules: the prompt follows the target model family's writing rules given per shot.",
  "- plan_fidelity: the Korean scene's setting, subjects, mood, and composition survive into the English prompt without loss or invention.",
  "- reference_alignment: shots with characterVisible=false contain no character appearance or person-as-subject wording; visible shots keep identity details consistent with the plan.",
  "Then judge cross_shot_consistency once for the whole set: outfit, time of day, lighting, and location wording must read as one coherent post across shots.",
  "Scoring: reason briefly first, then an integer 1-5 per dimension (5 = excellent, 3 = acceptable with issues, 1 = must fix).",
  "Static lint findings are provided per shot as hints; verify them, do not merely repeat them.",
  "Write reasons and issues in Korean (operator-facing), quoting problematic prompt fragments verbatim in English.",
  "Return shots in the same order as the input, one entry per shot.",
  "Return only the JSON below, with no explanation or Markdown:",
  '{"shots": [{"sortOrder": 0, "scores": {"scene_capture_separation": {"score": 4, "reason": "..."}, "physical_consistency": {"score": 3, "reason": "..."}, "model_family_rules": {"score": 5, "reason": "..."}, "plan_fidelity": {"score": 4, "reason": "..."}, "reference_alignment": {"score": 5, "reason": "..."}}, "issues": ["..."], "suggestions": ["..."]}], "crossShot": {"score": 4, "issues": ["..."]}}',
].join("\n");

export function buildPromptEvaluatorUserPrompt(
  input: PromptEvaluationPromptInput,
): string {
  const shots = input.shots
    .map((shot) =>
      [
        `### Shot ${shot.sortOrder}`,
        `Korean scene (final frame): ${shot.scene}`,
        `Korean capture setup (viewpoint metadata): ${shot.captureSetup}`,
        `Character visible: ${shot.characterVisible ? "yes" : "no"}`,
        `Target model: ${shot.targetModelId?.trim() || "(unspecified)"}`,
        `Target model family rules:\n${modelFamilyGuidance(shot.targetModelId)}`,
        `Built English prompt under evaluation:\n${shot.prompt}`,
        `Static lint findings: ${
          shot.lintIssues.length > 0
            ? shot.lintIssues.map((issue) => `\n- ${issue}`).join("")
            : "(none)"
        }`,
      ].join("\n"),
    )
    .join("\n\n");
  return [
    `## Post context\nCaption (for mood reference): ${input.planCaption}`,
    `## Shots\n${shots}`,
    `## Request\nEvaluate all ${input.shots.length} shot prompt(s) and the cross-shot consistency, then return the JSON verdict.`,
  ].join("\n\n");
}
