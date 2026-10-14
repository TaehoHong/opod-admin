import { POST_PLAN_JSON_SCHEMA } from "./post-planner";
import { IMAGE_PLAN_JSON_SCHEMA } from "./image-planner";

export const STRUCTURED_PLANNING = "structured-v1" as const;
export const LOCATION_AFTER_CONCEPT = "structured-v2" as const;
export const CONTEXT_FACT_SELECTION = "structured-v3" as const;
export const IMAGE_REFERENCE_SELECTION = "structured-v4" as const;
export const COHERENT_VISUAL_DECISIONS = "structured-v5" as const;
export type StructuredPlanningContract =
  | typeof STRUCTURED_PLANNING
  | typeof LOCATION_AFTER_CONCEPT
  | typeof CONTEXT_FACT_SELECTION
  | typeof IMAGE_REFERENCE_SELECTION
  | typeof COHERENT_VISUAL_DECISIONS;
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
    contract === IMAGE_REFERENCE_SELECTION ||
    contract === COHERENT_VISUAL_DECISIONS
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
  if (
    contract === IMAGE_REFERENCE_SELECTION ||
    contract === COHERENT_VISUAL_DECISIONS
  ) {
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
  if (contract === COHERENT_VISUAL_DECISIONS) {
    const descriptions = {
      subject: "Main subject visible in this photograph.",
      wardrobe: "Clothing worn in this shot; null when irrelevant.",
      setting:
        "Visible space and relevant layout, consistent with the approved place.",
      poseAction:
        "Body position, support and contact at the captured instant, including any ongoing action; consistent with the camera position.",
      expressionGaze:
        "Expression and gaze target at that same instant; null when not visible or unnecessary.",
      props:
        "Objects needed in the chosen scene, without a story explaining their presence.",
      framing:
        "Visible extent, cropping and subject placement from the chosen camera position.",
      camera:
        "Capture method and physical camera position and direction relative to the subject; compatible with pose and framing.",
      lighting:
        "Relevant light sources and their effect in this scene; null when no specific decision is needed.",
    };
    shot.properties.visualDetails = object(
      Object.fromEntries(
        Object.entries(VISUAL_DETAILS_SCHEMA.properties).map(
          ([key, schema]) => [
            key,
            {
              ...(structuredClone(schema) as object),
              description: descriptions[key as keyof typeof descriptions],
            },
          ],
        ),
      ),
    );
    shot.properties.notInFrame = {
      ...(shot.properties.notInFrame as object),
      description:
        "Exclusions supported by an applicable input restriction or by the chosen crop or occlusion. Preserve their original target and scope; [] if none apply.",
    };
    const production = postReady.properties.production as Variant;
    production.properties.requirements = {
      ...(PRODUCTION_SCHEMA.properties.requirements as object),
      description:
        "Required visible outcomes of this post, stated so image planning can realize them; no rationale or optional preferences converted into mandates.",
    };
  }
  return { post_plan: post, image_plan: image };
}

// Explicitly installed in DB; never used as runtime prompt fallbacks.
export const STRUCTURED_PLANNING_PROMPTS = {
  post_plan: `Role
Choose a concrete post concept, location, supported format and ordered content from this character's account concept, visual style, relevant persona and memories, recent posts and operator request. Preserve intended fashion or sexual appeal and the account's room for ordinary life.

Account fit and visual focus
Start from accountConcept and imageStyle, then choose why this account would share this concrete subject or moment. State that premise and posting purpose in intent. For each shot, choose what the viewer should notice first: the person, an action, the person's relationship to the environment, or an object or space. Write the visible content and that visual focus in production.shots.content so image planning receives the decision; keep the reason for selecting it in accountFit. A character's presence does not automatically make the face or full body the visual center. Compare another plausible focus internally and choose for this purpose, without quotas or random rotation. Ordinary life and variation in intensity remain valid when their treatment fits this account; do not default to generic furniture, clothing or lifestyle advertising. Recent posts inform repetition and context, not mandatory story continuation. After a provider refusal, respect its restrictions while preserving the account's purpose and visual style; merely generating a generic replacement is not success. Report an actual conflict when supplied requirements cannot be reconciled.

Decisions
State what this post shows, not a broad theme. Choose the setting from the concept and authored facts, without a registered-location menu. Always set location.id=null and describe the intended place briefly in location.description; registration is resolved downstream. Preserve needed established place facts by selecting their contextFactId. Do not invent changes to an established place. A new setting is not an established home layout, past event or new canon. Choose single_image or carousel using productionCapabilities; a reel placement does not provide video generation. Return a grounded conflict when an explicit video-only request cannot be produced. Choose the necessary number of shots within maxImages, with zero-based consecutive sortOrder values and one distinct content description per shot. Do not pad the count.
Fix clothing, activities or other elements here only when central to the concept or required by authored instructions. Put those decisions in requirements as required visible outcomes. Distinguish what must be recognizable in the photo from the reason for choosing it; keep optional preferences optional. Leave poses, camera geometry and scene detail to image planning. Select the contextFactId values of persona or memory entries needed for image planning into contextFactIds (at most 8, no duplicates; [] when none are needed). Use only IDs supplied in this input; the server forwards their original content. Return no paths or quotes in contextFactIds. Selected entries provide context, not extra scenes to illustrate. Account concept, image style and constraints are forwarded separately and need no selection. Never convert conversation examples into events.

Output
Use the supplied schema. Keep premise, purpose, accountFit and shot descriptions brief; rationale stays in accountFit, not the visual content. Do not invent actions or props to prove personality or a backstory. Keep newMemoryCandidates empty. Conflict operands must quote actual inputs.`,
  image_plan: `Role
Realize the approved post as photographic specifications. Preserve its concept, place, shot count, identity, boundaries, style and intended appeal. Make necessary visual choices without adding a story or imposing a universal photographic look.

1. Establish the requirements
Identify the required visible outcome of each shot. Distinguish it from background context, optional preferences and recent history. Apply input restrictions to their stated subjects and scope, including qualifications. A restriction on one element does not prohibit a broader category. Preserve genuinely broad restrictions; do not silently narrow them to make a plan work.
Supplied locations are optional supporting records. Select locationId only when the record supports the already planned place and requirements, not merely its category. Otherwise use null while preserving established place facts. Only a selected location's references and restrictions apply.

2. Decide one photograph
Choose the captured instant, subject state and physical camera position together. An activity, pause or intentional pose is equally valid. Determine expression and gaze at that instant, body support and contact, then what the chosen viewpoint includes or hides. Camera position, device placement, pose and visible extent must agree. A sequence may inform the scene, but each shot specifies its own captured state.
For phone or mirror photography, choose a jointly feasible shoulder-elbow-wrist connection, reachable phone grip, device/lens orientation, reflection and resulting viewpoint at that instant; ordinary occlusion is valid and does not require every finger to be visible.
Read each production.shots.content with postPlan.intent and the supplied account style. Use its visual focus to choose the subject-environment relationship, who operates the camera, and a physical camera position and direction that realize that purpose. Compare another valid viewpoint internally before selecting one. Carry the choice into visualDetails: camera records the capture method and physical position; framing records the shot scale or distance, character's relative frame occupancy and placement, crop, and necessary foreground/background depth and visual path. Keep these relationships concise and consistent so image prompt generation receives the chosen composition, not a catalogue of everything to show. References supply scoped identity or environment attributes; do not reverse-design the scene from a reference's crop or subject scale. A centered portrait, close-up, selfie or fashion photograph remains valid for a fitting purpose; do not impose off-center framing, wide angles, occlusion, props, activity, quotas or random rotation. Recent visual history describes earlier plans rather than inspected generated pixels. Keep incidental hand side and crop choices optional.
Use references for needed identity or environment attributes, separating these from current clothing, expression, pose and light. Describe referenced identity in its reference scope rather than repeating an appearance catalogue. Decide only details needed for the shot; leave incidental choices open. Do not create props or gestures to explain a motive or past event.

3. Record that decision
Populate visualDetails according to the field descriptions using concise factual phrases. Fields describe the same photograph, not independent alternatives. Repeat necessary relationships consistently rather than redefining them. Preserve mood or medium when it changes rendering; omit explanations. Use null or [] where applicable.
Inspect reference pixels and select references by supplied referenceId and source, with needed purposes, preserve and avoidCopying scopes. The server assigns internal binding IDs.
Derive characterPresentation and subjectCameraRelation from the chosen shot. Use reflection or silhouette when applicable, otherwise full or partial for visible extent, or none for no character. visibleParts and faceVisible must match cropping and occlusion. A visible face requires identityPreservationRequired=true and an identity-purpose reference. With none, use visibleParts=[], both booleans=false and subjectCameraRelation=not_applicable.
Record continuity only for attributes shared by at least two distinct existing shots. Use concrete details and unique sortOrder values. A single shot has lockedElements=[]. Continuity describes a relationship, not an available visual reference.

4. Check the whole plan
Compare the finished shots with required outcomes and applicable restrictions. Resolve omissions or contradictions in your own visual choices before returning ready. If required input conditions cannot coexist, return blocked with exact input evidence and alternatives considered; do not silently weaken them. Missing incidental detail or optional references alone is not a blocker. Keep zero-based shot order and return only the supplied schema, without planning commentary.`,
  image_prompt: `Role
Translate the approved visualDetails into a concise English image-generation prompt using the supplied schema and model policy. Retain required in-image text in its specified language. Do not re-plan.

Content
Combine the fields into one photograph. Preserve approved clothing, expression, gaze, pose, spatial relationships, framing, camera, medium and light. Null fields are intentionally unspecified, not requests to invent details. Retain mood when it controls rendering; omit planning explanations and past events. Do not add props or gestures to illustrate omitted context. Do not add beautification, photographic upgrades or force all features to be visible.

Prompt format
Inside each shot's prompt string, use only the following English section titles, in this order, each followed by a colon and concise natural-language sentences:
- Scene: the main subject, setting and placement of necessary props.
- Wardrobe: approved visible clothing and how it is worn.
- Pose, Expression & Gaze: the captured instant's posture, action, support, contact, expression and gaze target.
- Camera & Framing: capture method, camera position and direction, then visible extent and placement within the frame.
- Lighting: approved light sources and their effect in the scene.
- Style: supplied photographic medium and rendering choices compatible with the approved shot.
- References: each supplied image number's use and preservation scope.
- Constraints: applicable restrictions not already expressed elsewhere, following the active model policy.
Include a section only when the supplied plan or applicable instructions provide relevant content. Omit both its title and body otherwise; do not output empty sections, null, N/A or placeholders. These sections organize existing decisions; they are not a checklist of details to invent. Do not infer missing clothing, props, expressions, gaze, camera settings, lighting, style or restrictions merely to fill a section. Keep relationships in complete short sentences, and give each fact one home rather than repeating it across sections. Keep this formatting inside the existing prompt string; do not add JSON fields.

References
State each reference's preserve/change/avoid scope once using the supplied image number. Use likeness and necessary distinguishing traits without repeating an appearance catalogue. Keep current expression, pose and light separate from stable identity. Preserve shared elements, merge equivalent exclusions within their scope, and add no new prohibitions. Return only the output schema.`,
};
