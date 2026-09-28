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
- Use the assigned reference labels exactly, such as "Image 1".
- This model uses no separate negative prompt. Set negativePrompt to null and express applicable exclusions in the main prompt.`;

function policy(
  modelId: string,
  supportsReferences: boolean,
): ImageModelPolicy {
  return {
    id: "nano-banana-natural-language",
    version: "nano-banana-policy-v5",
    modelId,
    usesNegativePrompt: false,
    supportsReferences,
    maxReferencesPerShot: supportsReferences ? 3 : 0,
    referenceSlotPrefix: "Image",
    instructions: nanoBananaInstructions,
  };
}

const fluxKontextInstructions = `Active target model: FLUX.1 Kontext [dev].
- Write in precise English natural language.
- Use the assigned reference labels exactly, such as "Reference image 1".
- This model uses no separate negative prompt. Set negativePrompt to null and express applicable exclusions in the main prompt.`;

const fluxKontextPolicy: ImageModelPolicy = {
  id: "flux-kontext-natural-language",
  version: "flux-kontext-policy-v4",
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
      version: "gpt-image-policy-v3",
      modelId: "gpt-image-2.5-sunburst",
      usesNegativePrompt: false,
      supportsReferences: true,
      maxReferencesPerShot: 10,
      referenceSlotPrefix: "Image",
      instructions: `Active target model: GPT Image 2.5 Sunburst.
- Use the assigned reference labels exactly, such as "Image 1".
- This model uses no separate negative prompt. Set negativePrompt to null and express applicable exclusions in the main prompt.`,
    },
    [fluxKontextPolicy.modelId]: fluxKontextPolicy,
  };
