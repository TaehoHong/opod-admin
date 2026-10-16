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

// SpicyAPI Qwen Image 3.0 계열. edit는 순서대로 1~3장을 "Image N"으로 받는다.
// 공통 네거티브는 생성 시 DB 설정에서 별도로 붙인다. Agent는 컷별 조건만 작성한다.
function qwenImagePolicy(
  modelId: string,
  label: string,
  supportsReferences: boolean,
): ImageModelPolicy {
  return {
    id: "qwen-image-3-natural-language",
    version: "qwen-image-3-policy-v2",
    modelId,
    usesNegativePrompt: true,
    supportsReferences,
    maxReferencesPerShot: supportsReferences ? 3 : 0,
    referenceSlotPrefix: "Image",
    instructions: [
      `Active target model: ${label}.`,
      "- Write in English natural language and keep each prompt under 4,500 characters.",
      ...(supportsReferences
        ? ['- Use the assigned reference labels exactly, such as "Image 1".']
        : []),
      "- Put only shot-specific exclusions in negativePrompt, in English, at most 2,000 characters. Use null when none are needed; do not invent exclusions to fill the field.",
      "- A DB-managed common negative prompt is added separately at generation time; do not repeat general quality or anatomy exclusions.",
    ].join("\n"),
  };
}

// SpicyAPI Seedream 5.0 Pro. Qwen과 사진 결을 비교하려고 같은 형식 규칙만 둔다.
// edit는 레퍼런스를 10장까지 받고 별도 negative 입력이 없다.
function seedreamPolicy(
  modelId: string,
  supportsReferences: boolean,
): ImageModelPolicy {
  return {
    id: "seedream-5-natural-language",
    version: "seedream-5-policy-v1",
    modelId,
    usesNegativePrompt: false,
    supportsReferences,
    maxReferencesPerShot: supportsReferences ? 10 : 0,
    referenceSlotPrefix: "Image",
    instructions: [
      "Active target model: Seedream 5.0 Pro.",
      "- Write in English natural language and keep each prompt under 4,500 characters.",
      ...(supportsReferences
        ? ['- Use the assigned reference labels exactly, such as "Image 1".']
        : []),
      "- Set negativePrompt to null and express applicable exclusions in the main prompt.",
    ].join("\n"),
  };
}

export const IMAGE_MODEL_POLICIES: Readonly<Record<string, ImageModelPolicy>> =
  {
    "bytedance/seedream-5.0-pro/edit": seedreamPolicy(
      "bytedance/seedream-5.0-pro/edit",
      true,
    ),
    "bytedance/seedream-5.0-pro/text-to-image": seedreamPolicy(
      "bytedance/seedream-5.0-pro/text-to-image",
      false,
    ),
    "alibaba/qwen-image-3.0-pro/edit": qwenImagePolicy(
      "alibaba/qwen-image-3.0-pro/edit",
      "Qwen Image 3.0 Pro",
      true,
    ),
    "alibaba/qwen-image-3.0-pro/text-to-image": qwenImagePolicy(
      "alibaba/qwen-image-3.0-pro/text-to-image",
      "Qwen Image 3.0 Pro",
      false,
    ),
    "alibaba/qwen-image-3.0/edit": qwenImagePolicy(
      "alibaba/qwen-image-3.0/edit",
      "Qwen Image 3.0",
      true,
    ),
    "alibaba/qwen-image-3.0/text-to-image": qwenImagePolicy(
      "alibaba/qwen-image-3.0/text-to-image",
      "Qwen Image 3.0",
      false,
    ),
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
