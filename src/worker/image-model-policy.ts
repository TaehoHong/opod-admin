import {
  IMAGE_MODEL_POLICIES,
  ImageModelPolicy,
} from "../../prompts/image-model-policies";
import { ImagePlanReady } from "./image-planner";

export type PromptReferenceSlot = {
  shotSortOrder: number;
  bindingId: string;
  referenceId: string;
  slot: string;
  source: "identity" | "environment";
  semanticPurposes: string[];
  preserve: string[];
  avoidCopying: string[];
};

export type PromptBuildPackage = {
  targetModelId: string;
  imagePlan: ImagePlanReady;
  subjectContract: {
    appearance: string;
    visualStyle: string | null;
    exclusions: string[];
  };
  referenceSlots: PromptReferenceSlot[];
  modelPolicy: {
    id: string;
    version: string;
    instructions: string;
    usesNegativePrompt: boolean;
  };
};

export class UnsupportedImagePlanError extends Error {
  constructor(
    readonly code:
      "unknown_model" | "references_not_supported" | "too_many_references",
  ) {
    super(code);
    this.name = "UnsupportedImagePlanError";
  }
}

export function resolveImageModelPolicy(modelId: string): ImageModelPolicy {
  const policy = IMAGE_MODEL_POLICIES[modelId];
  if (!policy) throw new UnsupportedImagePlanError("unknown_model");
  return policy;
}

export function buildPromptPackage(input: {
  targetModelId: string;
  imagePlan: ImagePlanReady;
  appearance: string;
  visualStyle?: string;
  exclusions?: string[];
}): PromptBuildPackage {
  const policy = resolveImageModelPolicy(input.targetModelId);
  const referenceSlots: PromptReferenceSlot[] = [];
  for (const shot of input.imagePlan.shots) {
    if (shot.referenceBindings.length > 0 && !policy.supportsReferences) {
      throw new UnsupportedImagePlanError("references_not_supported");
    }
    if (shot.referenceBindings.length > policy.maxReferencesPerShot) {
      throw new UnsupportedImagePlanError("too_many_references");
    }
    shot.referenceBindings.forEach((binding, index) => {
      referenceSlots.push({
        shotSortOrder: shot.sortOrder,
        bindingId: binding.bindingId,
        referenceId: binding.id,
        slot: `${policy.referenceSlotPrefix} ${index + 1}`,
        source: binding.source,
        semanticPurposes: binding.semanticPurposes,
        preserve: binding.preserve,
        avoidCopying: binding.avoidCopying,
      });
    });
  }
  return {
    targetModelId: input.targetModelId,
    imagePlan: input.imagePlan,
    subjectContract: {
      appearance: input.appearance.trim(),
      visualStyle: input.visualStyle?.trim() || null,
      exclusions: (input.exclusions ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    },
    referenceSlots,
    modelPolicy: {
      id: policy.id,
      version: policy.version,
      instructions: policy.instructions,
      usesNegativePrompt: policy.usesNegativePrompt,
    },
  };
}
