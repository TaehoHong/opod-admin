export type ImageModelPolicy = {
  id: string;
  version: string;
  modelId: string;
  usesNegativePrompt: boolean;
  supportsReferences: boolean;
  maxReferencesPerShot: number;
  instructions: string;
};

const nanoBananaInstructions = `Active target model: Nano Banana.
- Write each prompt as a concrete natural-language art-direction brief, not tag lists, quality-token stacks, or generic praise.
- When slots exist, state each reference contract separately before the final-image description. Address images only by the supplied positional phrase such as "Image 1". Never emit an internal binding ID.
- Keep each avoidCopying condition scoped to its own image instruction; never turn it into a whole-image prohibition.
- Then express the approved shot as one coherent, independently executable final-image brief.
- Quote exact visible display text verbatim.
- This model uses no separate negative prompt. Set negativePrompt to null and express applicable subject exclusions in the main prompt.`;

function policy(
  modelId: string,
  supportsReferences: boolean,
): ImageModelPolicy {
  return {
    id: "nano-banana-natural-language",
    version: "nano-banana-policy-v1",
    modelId,
    usesNegativePrompt: false,
    supportsReferences,
    maxReferencesPerShot: supportsReferences ? 3 : 0,
    instructions: nanoBananaInstructions,
  };
}

export const IMAGE_MODEL_POLICIES: Readonly<Record<string, ImageModelPolicy>> =
  {
    "fal-ai/nano-banana": policy("fal-ai/nano-banana", false),
    "fal-ai/nano-banana/edit": policy("fal-ai/nano-banana/edit", true),
    "fal-ai/nano-banana-pro": policy("fal-ai/nano-banana-pro", false),
    "fal-ai/nano-banana-pro/edit": policy("fal-ai/nano-banana-pro/edit", true),
  };
