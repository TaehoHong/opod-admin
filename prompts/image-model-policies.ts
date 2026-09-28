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
- Preserve only each reference's assigned attributes. Identity evidence establishes the same character, not automatic reuse of source pose, expression, illumination, color treatment, or background. Keep requested intrinsic traits distinct from source lighting. Any other attribute explicitly selected for preservation must agree with imagePlan; unselected attributes neither transfer automatically nor become whole-image exclusions.
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
    version: "nano-banana-policy-v4",
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
- Multiple identity (person) references are additional evidence for the same main character. Combine their requested identity evidence into one person; do not create one person per reference. Preserve the assigned identifying traits without automatically carrying over source pose, expression, illumination, color treatment, or background. Intrinsic coloring is distinct from source lighting.
- Every reference, including an environment reference, contributes only its assigned preservation scope. Do not automatically import unselected content or turn its absence from that scope into a whole-image ban. Any selected spatial, framing, object, or lighting attribute must agree with imagePlan; describe the final shot from its planned viewpoint.
- Keep each avoidCopying condition scoped to its own reference instruction.
- Integrate imagePlan's behavior, framing, viewpoint, and visible state without repeating facts already expressed. Include lighting, color, medium, and finish only when supplied; do not complete a photographic checklist.
- Quote exact visible display text verbatim.
- This model uses no separate negative prompt. Set negativePrompt to null and express only applicable visible exclusions concisely in the main prompt.`;

const fluxKontextPolicy: ImageModelPolicy = {
  id: "flux-kontext-natural-language",
  version: "flux-kontext-policy-v3",
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
    "gpt-image-2.5-sunburst": {
      id: "gpt-image-natural-language",
      version: "gpt-image-policy-v2",
      modelId: "gpt-image-2.5-sunburst",
      usesNegativePrompt: false,
      supportsReferences: true,
      maxReferencesPerShot: 10,
      referenceSlotPrefix: "Image",
      instructions: `Active target model: GPT Image 2.5 Sunburst.
- Use concise natural language describing the intended final image. Preserve supplied facts, counts, framing, visible text, and exclusions; do not add photographic embellishments.
- Refer to each supplied image by its positional label (Image 1, Image 2). State only its assigned role and what to preserve or avoid copying.
- Identity references preserve the assigned identifying traits of the same person. Identity does not require copying source pose, expression, illumination, color treatment, or background. Preserve requested intrinsic traits while following the shot's supplied lighting and style.
- Every reference, including an environment reference, contributes only its assigned preservation scope. Other attributes transfer only when explicitly selected and consistent with imagePlan. Unselected content neither transfers automatically nor becomes a whole-image prohibition. ImagePlan owns the final scene and viewpoint.
- Quote exact visible text. Put supplied exclusions concisely in the prompt and return negativePrompt: null.`,
    },
    [fluxKontextPolicy.modelId]: fluxKontextPolicy,
  };
