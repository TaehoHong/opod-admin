import { POST_PLAN_JSON_SCHEMA } from "./post-planner";
import { IMAGE_PLAN_JSON_SCHEMA } from "./image-planner";

export const STRUCTURED_PLANNING = "structured-v1" as const;
export const LOCATION_AFTER_CONCEPT = "structured-v2" as const;
export const CONTEXT_FACT_SELECTION = "structured-v3" as const;
export const IMAGE_REFERENCE_SELECTION = "structured-v4" as const;
export type StructuredPlanningContract =
  | typeof STRUCTURED_PLANNING
  | typeof LOCATION_AFTER_CONCEPT
  | typeof CONTEXT_FACT_SELECTION
  | typeof IMAGE_REFERENCE_SELECTION;
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
export function structuredPlanningSchemas(
  contract: StructuredPlanningContract = STRUCTURED_PLANNING,
) {
  const post = structuredClone(POST_PLAN_JSON_SCHEMA);
  const image = structuredClone(IMAGE_PLAN_JSON_SCHEMA);
  type Variant = { properties: Record<string, unknown>; required: string[] };
  const variants = (schema: Record<string, unknown>) =>
    (schema.properties as { result: { anyOf: Variant[] } }).result.anyOf;
  const postReady = variants(post)[0];
  postReady.properties.production =
    contract !== STRUCTURED_PLANNING
      ? object({
          ...PRODUCTION_SCHEMA.properties,
          location: object({ id: { type: "null" }, description: text() }),
        })
      : PRODUCTION_SCHEMA;
  if (
    contract === CONTEXT_FACT_SELECTION ||
    contract === IMAGE_REFERENCE_SELECTION
  ) {
    const production = postReady.properties.production as Variant;
    delete production.properties.contextFacts;
    production.properties.contextFactIds = {
      type: "array",
      maxItems: 8,
      items: text(100),
    };
    production.required = production.required.filter(
      (key) => key !== "contextFacts",
    );
    production.required.push("contextFactIds");
  }
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
  if (contract === IMAGE_REFERENCE_SELECTION) {
    const references = shot.properties.referenceBindings as { items: Variant };
    delete shot.properties.referenceBindings;
    shot.properties.references = references;
    shot.required = shot.required.map((key) =>
      key === "referenceBindings" ? "references" : key,
    );
    const binding = references.items;
    binding.properties.referenceId = binding.properties.id;
    binding.properties.purposes = binding.properties.semanticPurposes;
    delete binding.properties.bindingId;
    delete binding.properties.id;
    delete binding.properties.semanticPurposes;
    binding.required = [
      "referenceId",
      "source",
      "purposes",
      "preserve",
      "avoidCopying",
    ];
  }
  return { post_plan: post, image_plan: image };
}

// Explicitly installed in DB; never used as runtime prompt fallbacks.
export const STRUCTURED_PLANNING_PROMPTS = {
  post_plan: `Role
Choose a concrete post concept, location, supported format and ordered content from this character's account concept, visual style, relevant persona and memories, recent posts and operator request. Preserve intended fashion or sexual appeal and the account's room for ordinary life.

Decisions
State what this post shows, not a broad theme. Choose the setting from the concept and authored facts, without a registered-location menu. Always set location.id=null and describe the intended place briefly in location.description; registration is resolved downstream. Preserve needed established place facts by selecting their contextFactId. Do not invent changes to an established place. A new setting is not an established home layout, past event or new canon. Choose single_image or carousel using productionCapabilities; a reel placement does not provide video generation. Return a grounded conflict when an explicit video-only request cannot be produced. Choose the necessary number of shots within maxImages, with zero-based consecutive sortOrder values and one distinct content description per shot. Do not pad the count.
Fix clothing, activities or other elements here only when central to the concept or required by authored instructions. Put those decisions in requirements. Leave poses, camera geometry and scene detail to image planning. Select the contextFactId values of persona or memory entries needed for image planning into contextFactIds (at most 8, no duplicates; [] when none are needed). Use only IDs supplied in this input; the server forwards their original content. Return no paths or quotes in contextFactIds. Selected entries provide context, not extra scenes to illustrate. Account concept, image style and constraints are forwarded separately and need no selection. Never convert conversation examples into events.

Output
Use the supplied schema. Keep premise, purpose, accountFit and shot descriptions brief; rationale stays in accountFit, not the visual content. Do not invent actions or props to prove personality or a backstory. Keep newMemoryCandidates empty. Conflict operands must quote actual inputs.`,
  image_plan: `Role
Turn the approved production concept, location, ordered shots and requirements into concise photographic specifications. Preserve authored identity, boundaries, image style and intended appeal. Choose a realization that satisfies these together; do not silently replace the approved concept, setting, format or shots. Preferences, recent visual history and optional references guide compatible choices, not new requirements.

Visual decisions
Write visualDetails in short factual phrases. subject identifies the main subject; wardrobe specifies current clothing; setting describes the space; poseAction describes posture, action and contact; expressionGaze specifies expression and gaze target; props lists needed objects; framing defines visible extent and placement; camera defines capture method, viewpoint and direction; lighting defines relevant illumination. Avoid retelling identity attributes already assigned to a reference. Keep necessary relationships even when the same object appears in multiple fields.
Decide what is necessary to realize each shot: pose, gaze, support, contact, framing and camera must form one feasible photograph. Leave incidental details open; use null or [] for inapplicable or unnecessary decisions. Describe visible content and rendering, not motives or past events. Do not invent props or gestures to prove a story. An intentional portrait, a pause and an activity are all valid. Do not impose a universal photographic look. Avoid redundant prose within fields; repeat shared attributes consistently where each shot needs them to stand alone.

Location matching
Supplied locations are optional supporting records, not a menu. Select locationId only when the record and authored context support the already planned place and requirements; a shared category is insufficient. Otherwise use null. Preserve established place facts and leave unknown details open. Unselected locations' references and exclusions do not apply.

References and visibility
Inspect reference pixels and supplied IDs. In references, select referenceId and source, specify purposes, and assign only needed preserve and avoidCopying attributes. Separate stable identity from current clothing, pose, expression, framing and light. The same reference may serve multiple shots with different scopes. Internal binding IDs are assigned by the server.
Use characterPresentation.mode to describe presentation: reflection for a reflected character, silhouette for a silhouette, otherwise full or partial for visible extent, or none for no character. visibleParts records relevant visible body regions; keep it consistent with framing and occlusion. A visible face requires identityPreservationRequired=true and an identity-purpose reference. With mode=none, visibleParts=[], faceVisible=false, identityPreservationRequired=false and subjectCameraRelation=not_applicable. Otherwise choose the camera relationship from the planned behavior. notInFrame contains only exclusions justified by input constraints or the chosen capture.

Continuity and completion
Record only attributes that must remain consistent across two or more distinct existing shots, with concrete identifying details when needed. appliesToShots uses their sortOrder values without duplicates. For one shot, or no shared requirements, lockedElements=[]. A continuity instruction states the intended relationship; it is not itself a visual reference, and optional reference absence alone does not make a plan impossible.
Keep the approved shot count and zero-based order. Return ready when the required visual decisions are compatible. Return blocked only when required conditions cannot be satisfied together, citing exact input conditions and alternatives considered; unspecified incidental details alone are not blockers. Output only the supplied schema.`,
  image_prompt: `Role
Translate the approved visualDetails into a concise English image-generation prompt using the supplied schema and model policy. Retain required in-image text in its specified language. Do not re-plan.

Content
Combine the fields into one photograph. Preserve approved clothing, expression, gaze, pose, spatial relationships, framing, camera, medium and light. Null fields are intentionally unspecified, not requests to invent details. Retain mood when it controls rendering; omit planning explanations and past events. Do not add props or gestures to illustrate omitted context. Do not add beautification, photographic upgrades or force all features to be visible.

References
State each reference's preserve/change/avoid scope once using the supplied image number. Use likeness and necessary distinguishing traits without repeating an appearance catalogue. Keep current expression, pose and light separate from stable identity. Preserve shared elements, merge equivalent exclusions within their scope, and add no new prohibitions. Return only the output schema.`,
};
