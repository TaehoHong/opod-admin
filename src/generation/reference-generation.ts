import { BadRequestException } from "@nestjs/common";
import { v5 as uuidv5 } from "uuid";
import type { ReferenceImage } from "../post-production/reference-captioner";
import type { ReferenceAgentGenerationConfig } from "../post-production/reference-agent-config";
import { requestedImageAspectRatio } from "../post-production/generated-image-validation";
import { isRecord } from "../shared/utils/value-utils";

export type ReferenceGenerationShot = {
  shotId: string;
  sortOrder: number;
  prompt: string;
  negativePrompt: string;
  references: {
    id: string;
    role: "source" | "character_identity";
    inputOrder: number;
    promptLabel: string;
    sha256: string;
    media: ReferenceImage;
  }[];
  generation: ReferenceAgentGenerationConfig;
  generationParams: Record<string, unknown>;
};
export type EnsureReferenceDraftJobsInput = {
  draftId: string;
  characterId: string;
  promptRevision: string;
  shots: ReferenceGenerationShot[];
};
export type ReferenceGenerationMetadata = Omit<
  ReferenceGenerationShot,
  "sortOrder"
> & { promptRevision: string };

export function referenceJobId(
  draftId: string,
  promptRevision: string,
  shotId: string,
): string {
  return uuidv5(JSON.stringify([draftId, promptRevision, shotId]), uuidv5.URL);
}

export function freezeReferenceShot(
  promptRevision: string,
  shot: ReferenceGenerationShot,
): ReferenceGenerationMetadata {
  if (
    !promptRevision ||
    !shot.shotId ||
    !shot.prompt.trim() ||
    !Number.isInteger(shot.sortOrder) ||
    shot.sortOrder < 0 ||
    !shot.generation.id ||
    !shot.generation.aiModelId ||
    !shot.generation.provider ||
    !shot.generation.effectiveModel ||
    !Number.isInteger(shot.generation.revision) ||
    !isRecord(shot.generationParams) ||
    typeof shot.generationParams.aspect_ratio !== "string" ||
    !shot.generationParams.aspect_ratio.trim() ||
    requestedImageAspectRatio(shot.generationParams) === null ||
    Object.keys(shot.generationParams).some((key) => key.startsWith("_")) ||
    shot.references.length === 0 ||
    shot.references[0]?.role !== "source" ||
    shot.references.length > 10
  )
    throw new BadRequestException("Invalid reference generation snapshot");
  let identitySeen = false;
  const ids = new Set<string>();
  const references = shot.references.map((reference, index) => {
    if (reference.role === "character_identity") identitySeen = true;
    if (
      !reference.id ||
      ids.has(reference.id) ||
      !["source", "character_identity"].includes(reference.role) ||
      (identitySeen && reference.role === "source") ||
      reference.inputOrder !== index + 1 ||
      !reference.promptLabel.trim() ||
      !/^[a-f0-9]{64}$/i.test(reference.sha256)
    )
      throw new BadRequestException(
        "Invalid reference generation binding/order",
      );
    ids.add(reference.id);
    let media: ReferenceImage;
    if (reference.media.storageKey) {
      media = {
        url: "",
        storageKey: reference.media.storageKey,
        ...(reference.media.contentType
          ? { contentType: reference.media.contentType }
          : {}),
      };
    } else {
      const url = new URL(reference.media.url);
      if (
        url.protocol !== "https:" ||
        url.search ||
        url.username ||
        url.password
      )
        throw new BadRequestException(
          "Reference generation requires a stable HTTPS URL or storage key",
        );
      media = {
        url: url.toString(),
        ...(reference.media.contentType
          ? { contentType: reference.media.contentType }
          : {}),
      };
    }
    return {
      id: reference.id,
      role: reference.role,
      inputOrder: reference.inputOrder,
      promptLabel: reference.promptLabel,
      sha256: reference.sha256,
      media,
    };
  });
  return {
    promptRevision,
    prompt: shot.prompt,
    shotId: shot.shotId,
    negativePrompt: shot.negativePrompt,
    references,
    generation: {
      id: shot.generation.id,
      revision: shot.generation.revision,
      aiModelId: shot.generation.aiModelId,
      provider: shot.generation.provider,
      effectiveModel: shot.generation.effectiveModel,
    },
    generationParams: { ...shot.generationParams },
  };
}

export function referenceGenerationMetadata(
  params: unknown,
): ReferenceGenerationMetadata | null {
  if (!isRecord(params) || !("_referenceAgent" in params)) return null;
  const value = params._referenceAgent;
  if (
    !isRecord(value) ||
    !Array.isArray(value.references) ||
    !isRecord(value.generation) ||
    typeof value.promptRevision !== "string" ||
    typeof value.shotId !== "string" ||
    typeof value.prompt !== "string" ||
    typeof value.negativePrompt !== "string" ||
    !isRecord(value.generationParams)
  )
    throw new BadRequestException("Invalid reference generation metadata");
  // Reuse the input contract on persisted jobs before provider submission.
  return freezeReferenceShot(value.promptRevision, {
    ...value,
    sortOrder: 0,
    prompt: value.prompt,
  } as ReferenceGenerationShot);
}
