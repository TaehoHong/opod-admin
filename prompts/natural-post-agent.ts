import { POST_AGENT_CONTRACTS } from "./post-agent-contracts";

export const NATURAL_STAGES = [
  "post_plan",
  "image_plan",
  "image_prompt",
  "caption",
  "naturalness",
  "requirements",
] as const;
export type NaturalStage = (typeof NATURAL_STAGES)[number];
export const PHOTO_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          sortOrder: { type: "integer", minimum: 0, maximum: 2 },
          verdict: { type: "string", enum: ["accept", "reject"] },
          observations: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 2000 },
          },
        },
        required: ["sortOrder", "verdict", "observations"],
        additionalProperties: false,
      },
    },
  },
  required: ["shots"],
  additionalProperties: false,
};
export function naturalSchemas(): Record<
  NaturalStage,
  Record<string, unknown>
> {
  return Object.fromEntries(
    NATURAL_STAGES.map((stage) => [
      stage,
      stage === "naturalness" || stage === "requirements"
        ? PHOTO_REVIEW_SCHEMA
        : POST_AGENT_CONTRACTS[stage].outputSchema,
    ]),
  ) as Record<NaturalStage, Record<string, unknown>>;
}

// Starters are offered for explicit installation only. Runtime reads the saved bundle.
export const NATURAL_AGENT_STARTERS = {
  post_plan: `Plan an authentic social post for this character using the supplied output schema. Choose a concrete ordinary moment with a clear action. Honor authored identity, boundaries, production medium, and operator constraints. Recent posts inform repetition avoidance; continuing their story is optional. Do not invent canon or force an event into future memory. newMemoryCandidates should be empty. Return conflict only with the contract's actual input quotes. Photo composition belongs to the image planner; caption phrasing belongs to the caption writer.`,
  image_plan: `Plan photographs around the action, not a checklist of perfect face, body, outfit and background visibility. Inspect attached reference pixels and their labeled IDs before assigning uses. Keep fixed identity separate from mutable expression, pose, gaze, camera angle and light. Each reference binding must explicitly say which attributes to preserve and which pose, expression, framing, wardrobe or light to change/avoid copying. Connect gaze, hands, torso, weight and props to the same plausible action. Allow normal occlusion, asymmetry, cropped body parts and incidental background. Do not force eye contact or an attractive pose without scene motivation. Honor constraints and reference roles. Use the exact supplied schema; scene/subjectState/motionEvidence describe the action, preserve/avoidCopying express reference scope. Recent history is context, not mandatory continuity. Return blocked only with verifiable evidence required by the schema.`,
  image_prompt: `Write concise action-centered image prompts using the provided exact output schema and model policy. Translate the planned moment into a physically coherent photographed scene: connected gaze, hands, torso, support and prop contact. Preserve fixed identity through the assigned reference scope while changing mutable pose, expression and light as planned. State reference preserve/change/avoid scope explicitly. Do not demand simultaneously perfect face, body, outfit and background visibility, beautify every expression, or turn incidental details into rigid staging. Keep necessary constraints, normal occlusion, camera viewpoint and reference numbering. Avoid prompt stuffing and contradictory anatomy or impossible capture setups.`,
  caption: `Inspect the accepted generated photographs and write the character's social caption using the supplied exact schema. Use character voice and caption preferences, keep it brief and situated, avoid explaining every visual detail, slogans, forced questions and templates copied from recent captions. Do not narrate an event that the photos and authored context do not support. Return ready, caption, captionLanguages and normalized hashtags.`,
  naturalness: `Independently inspect ONLY the attached generated photo pixels. You have not received the plan or generation prompt: do not infer compliance or reward a plausible written story. For every labeled shot return accept or reject with concrete visual observations. Inspect anatomy, face/expression spontaneity, connected gaze/hands/torso/action, contact/support/weight, camera plausibility, compositing/background integration, lighting and distracting artifacts. Natural cropped/occluded bodies, asymmetric expressions and ordinary untidy scenes are acceptable. Reject visible unnaturalness or uncertainty that makes publishing unsafe; do not excuse defects because an intended action could explain them.`,
  requirements: `Inspect generated photo pixels against the supplied authored identity, actual assigned reference pixels and per-reference preserve/change/avoid scope, scene requirements and operator constraints. Use the prior independent visual findings without replacing them with prompt compliance. Check fixed identity only where visible/required; do not demand perfect visibility of face/body/outfit/background. Reject identity drift, required missing action/constraint, misleading capture or reference copying beyond intended scope. For every generated labeled shot return accept or reject and concrete evidence. Never override a failed independent naturalness review.`,
} as const;
