import { POST_PLAN_JSON_SCHEMA } from "./post-planner";
import { IMAGE_PLAN_JSON_SCHEMA } from "./image-planner";

export const STRUCTURED_PLANNING = "structured-v1" as const;
const text = (maxLength = 500) => ({ type: "string", minLength: 1, maxLength });
const nullable = { anyOf: [text(), { type: "null" }] };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const PRODUCTION_SCHEMA = object({
  format: { type: "string", enum: ["single_image", "carousel"] },
  location: object({ id: nullable, description: text() }),
  shots: {
    type: "array",
    minItems: 1,
    maxItems: 3,
    items: object({
      sortOrder: { type: "integer", minimum: 0, maximum: 2 },
      content: text(),
    }),
  },
  requirements: { type: "array", maxItems: 10, items: text() },
  contextFacts: {
    type: "array",
    maxItems: 8,
    items: object({ path: text(300), quote: text(2000) }),
  },
});

export const VISUAL_DETAILS_SCHEMA = object({
  subject: text(),
  wardrobe: nullable,
  setting: text(),
  poseAction: nullable,
  expressionGaze: nullable,
  props: { type: "array", maxItems: 8, items: text(300) },
  framing: text(),
  camera: text(),
  lighting: nullable,
});

// New contracts are opt-in. Saved legacy bundles and artifacts retain their schema.
export function structuredPlanningSchemas() {
  const post = structuredClone(POST_PLAN_JSON_SCHEMA);
  const image = structuredClone(IMAGE_PLAN_JSON_SCHEMA);
  type Variant = { properties: Record<string, unknown>; required: string[] };
  const variants = (schema: Record<string, unknown>) =>
    (schema.properties as { result: { anyOf: Variant[] } }).result.anyOf;
  const postReady = variants(post)[0];
  postReady.properties.production = PRODUCTION_SCHEMA;
  postReady.required.push("production");
  const conflict = variants(post)[1].properties.conflicts as {
    items: {
      properties: Record<
        "left" | "right",
        { properties: { source: { enum: string[] } } }
      >;
    };
  };
  for (const side of ["left", "right"] as const) {
    const values = conflict.items.properties[side].properties.source.enum;
    if (!values.includes("contentProfile.imageStyle"))
      values.push("contentProfile.imageStyle");
  }
  const imageReady = variants(image)[0];
  const shot = (imageReady.properties.shots as { items: Variant }).items;
  for (const key of [
    "scene",
    "captureSetup",
    "subjectState",
    "motionEvidence",
    "visualPurpose",
  ]) {
    delete shot.properties[key];
    shot.required = shot.required.filter((field) => field !== key);
  }
  shot.properties.visualDetails = VISUAL_DETAILS_SCHEMA;
  shot.required.push("visualDetails");
  return { post_plan: post, image_plan: image };
}

// Explicitly installed in DB; never used as runtime prompt fallbacks.
export const STRUCTURED_PLANNING_PROMPTS = {
  post_plan: `Role
Choose a concrete post concept, location, supported format and ordered content from this character's account concept, visual style, relevant persona and memories, recent posts and operator request. Preserve intended fashion or sexual appeal and the account's room for ordinary life.

Decisions
State what this post shows, not a broad theme. Select a supplied location ID or a new scene location with id=null and a short physical description. A new setting is not an established home layout, past event or new canon. Choose single_image or carousel using productionCapabilities; a reel placement does not provide video generation. Return a grounded conflict when an explicit video-only request cannot be produced. Choose the necessary number of shots within maxImages, with zero-based consecutive sortOrder values and one distinct content description per shot. Do not pad the count.
Fix clothing, activities or other elements here only when central to the concept or required by authored instructions. Put those decisions in requirements. Leave poses, camera geometry and scene detail to image planning. Select only facts needed downstream into contextFacts as exact quotes and paths from persona or memories; these are evidence, not extra scenes to illustrate. Never convert conversation examples into events.

Output
Use the supplied schema. Keep premise, purpose, accountFit and shot descriptions brief; rationale stays in accountFit, not the visual content. Do not invent actions or props to prove personality or a backstory. Keep newMemoryCandidates empty. Conflict operands must quote actual inputs.`,
  image_plan: `Role
Turn the approved production concept, location, ordered shots and requirements into concise photographic specifications. Do not choose a new concept, location, format or shot count. Honor authored image style, identity, boundaries and intended appeal.

Visual decisions
Write visualDetails as short factual phrases: subject, wardrobe, setting, poseAction, expressionGaze, props, framing, camera and lighting. Write each decision once. Use null or an empty props array when a field is inapplicable or needs no decision; do not invent gestures, props, expressions or lighting effects to fill fields. For animals and objects, describe only their relevant state. An intentional portrait, a pause and an activity are all valid.
Describe visible content and rendering, not motives, prior events or explanations of what a pose proves. Preserve important spatial, support, contact and camera relationships. Incidental details may remain open, cropped or occluded. Do not require all features to be visible at once or impose a universal photographic look.

References and output
Inspect reference pixels and IDs. Preserve only the assigned identity, clothing or environment attributes; distinguish current pose, expression, framing and light from reference identity. Record continuity only for shared elements and applicable shots; text alone does not supply a shared visual reference. Use only justified exclusions. Keep locationId equal to production.location.id and sortOrder equal to the approved shot order, starting at 0. Return a grounded blocked result when the plan cannot be realized. Output only the supplied schema.`,
  image_prompt: `Role
Translate the approved visualDetails into a concise English image-generation prompt using the supplied schema and model policy. Retain required in-image text in its specified language. Do not re-plan.

Content
Combine the fields into one photograph. Preserve approved clothing, expression, gaze, pose, spatial relationships, framing, camera, medium and light. Null fields are intentionally unspecified, not requests to invent details. Retain mood when it controls rendering; omit planning explanations and past events. Do not add props or gestures to illustrate omitted context. Do not add beautification, photographic upgrades or force all features to be visible.

References
State each reference's preserve/change/avoid scope once using the supplied image number. Use likeness and necessary distinguishing traits without repeating an appearance catalogue. Keep current expression, pose and light separate from stable identity. Preserve shared elements, merge equivalent exclusions within their scope, and add no new prohibitions. Return only the output schema.`,
};
