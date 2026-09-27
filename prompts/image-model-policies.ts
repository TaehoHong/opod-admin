export type ImageModelPolicy = {
  id: string;
  version: string;
  modelId: string;
  usesNegativePrompt: boolean;
  supportsReferences: boolean;
  maxReferencesPerShot: number;
  referenceSlotPrefix: string;
  instructions: string;
};

const nanoBananaInstructions = `Active target model: Nano Banana.
- Describe the final scene in a compact natural-language paragraph, not tag lists, quality-token stacks, or generic praise. Start with the subject, action or state, and essential framing; do not fill in optional photographic details.
- When slots exist, state each reference contract concisely, addressing images only by the supplied positional phrase such as "Image 1". Never emit an internal binding ID.
- An identity reference preserves only the requested identity or wardrobe attributes, including face, hair, skin, and natural body identity when requested. Never copy its pose, crop, background, camera geometry, or composition; those come only from imagePlan.
- Keep each avoidCopying condition scoped to its own image instruction; never turn it into a whole-image prohibition.
- Integrate these instructions into one independently executable brief without repeating the scene or redescribing reference identity as a catalogue of body details.
- Quote exact visible display text verbatim.
- This model uses no separate negative prompt. Set negativePrompt to null and express applicable subject exclusions in the main prompt.`;

function policy(
  modelId: string,
  supportsReferences: boolean,
): ImageModelPolicy {
  return {
    id: "nano-banana-natural-language",
    version: "nano-banana-policy-v3",
    modelId,
    usesNegativePrompt: false,
    supportsReferences,
    maxReferencesPerShot: supportsReferences ? 3 : 0,
    referenceSlotPrefix: "Image",
    instructions: nanoBananaInstructions,
  };
}

const fluxKontextInstructions = `Active target model: FLUX.1 Kontext [dev].
- Write a compact prompt in precise English natural language. Do not use tag stacks, prompt weights, generic quality-token piles, or chatty explanations. Include only details needed to express the supplied contract.
- Open with the desired final photograph and its main subject, action, and state. Treat the supplied references as source material for one new final image, not as separate subjects, a collage, or an iterative edit history.
- Address every supplied reference separately by its exact positional label, such as "Reference image 1", and state its supplied role and preservation scope. Never emit an internal binding ID and never vaguely ask the model to follow all references.
- Multiple identity (person) references are additional evidence for the same main character. Combine their requested identity evidence into one person; do not create one person per reference. Preserve only the supplied identity or wardrobe attributes. Pose, expression, crop, background, camera geometry, and composition always come from imagePlan.
- An environment reference preserves only its supplied concrete spatial, architectural, material, object, or lighting attributes. Do not import people, identity, or temporary props. Use text only when its preserve contract requests it. Camera viewpoint, crop, and composition always come from imagePlan.
- Keep each avoidCopying condition scoped to its own reference instruction.
- Integrate imagePlan's behavior, framing, viewpoint, and visible state without repeating facts already expressed. Include lighting, color, medium, and finish only when supplied; do not complete a photographic checklist.
- Quote exact visible display text verbatim.
- This model uses no separate negative prompt. Set negativePrompt to null and express only applicable visible exclusions concisely in the main prompt.`;

const fluxKontextPolicy: ImageModelPolicy = {
  id: "flux-kontext-natural-language",
  version: "flux-kontext-policy-v2",
  modelId: "black-forest-labs/FLUX.1-Kontext-dev",
  usesNegativePrompt: false,
  supportsReferences: true,
  maxReferencesPerShot: 5,
  referenceSlotPrefix: "Reference image",
  instructions: fluxKontextInstructions,
};

export const IMAGE_MODEL_POLICIES: Readonly<Record<string, ImageModelPolicy>> =
  {
    "fal-ai/nano-banana": policy("fal-ai/nano-banana", false),
    "fal-ai/nano-banana/edit": policy("fal-ai/nano-banana/edit", true),
    "fal-ai/nano-banana-pro": policy("fal-ai/nano-banana-pro", false),
    "fal-ai/nano-banana-pro/edit": policy("fal-ai/nano-banana-pro/edit", true),
    [fluxKontextPolicy.modelId]: fluxKontextPolicy,
  };
