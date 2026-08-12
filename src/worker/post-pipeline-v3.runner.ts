import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  IMAGE_PLAN_CONTRACT_VERSION,
  IMAGE_PLANNER_PROMPT_VERSION,
} from "../../prompts/image-planner";
import {
  IMAGE_PROMPT_GENERATOR_VERSION,
  PROMPT_SET_CONTRACT_VERSION,
} from "../../prompts/image-prompt-generator";
import {
  POST_PLAN_CONTRACT_VERSION,
  POST_PLANNER_PROMPT_VERSION,
} from "../../prompts/post-planner";
import { AppConfigService } from "../domain/config/app-config.service";
import { LlmLogService } from "../domain/llm-logs/llm-log.service";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { DraftWorkerRepository, PlannedDraft } from "./draft-worker.repository";
import {
  ImagePlanningAgent,
  ImagePlanReady,
  ImagePlannerInput,
} from "./image-planner";
import {
  buildPromptPackage,
  UnsupportedImagePlanError,
} from "./image-model-policy";
import { ImagePromptGenerationAgent } from "./image-prompt-generator";
import { canonicalJsonHash, isPostPipelineV3 } from "./post-pipeline-v3";
import {
  PostPlanningAgent,
  PostPlannerInput,
  PostPlanReady,
} from "./post-planner";
import { StrictJsonAgentClient } from "./strict-json-agent";
import { errorMessage, isRecord } from "./value-utils";

type V3Concept = Record<string, unknown> & {
  pipelineVersion: "post-pipeline-v3";
  pipeline: Record<string, unknown>;
};

@Injectable()
export class PostPipelineV3Runner {
  private readonly logger = new Logger(PostPipelineV3Runner.name);

  constructor(
    private readonly repository: DraftWorkerRepository,
    private readonly settings: GenerationSettingsService,
    private readonly llmLogs: LlmLogService,
    private readonly config: AppConfigService,
    private readonly random: () => number = Math.random,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async runCurrentStage(draftId: string): Promise<void> {
    const draft = await this.repository.findPlannedDraft(draftId);
    if (
      !draft ||
      draft.status !== "generating" ||
      !isPostPipelineV3(draft.conceptJson)
    )
      return;
    const concept = draft.conceptJson as V3Concept;
    const stage = concept.pipeline.stage;
    try {
      const planner = await this.settings.resolvePlannerSettings();
      if (!planner.apiUrl || !planner.apiKey || !planner.model) {
        await this.pause(draft, concept, "needs_configuration", [
          "planner_llm_missing",
        ]);
        return;
      }
      const client = new StrictJsonAgentClient(
        {
          apiUrl: planner.apiUrl,
          apiKey: planner.apiKey,
          model: planner.model,
        },
        this.fetchFn,
        this.llmLogs,
      );
      if (stage === "post_plan") {
        await this.runPostPlanning(draft, concept, client);
      } else if (stage === "image_plan") {
        await this.runImagePlanning(draft, concept, client);
      } else if (stage === "image_prompt") {
        await this.runPromptGeneration(draft, concept, client);
      } else {
        await this.pause(draft, concept, "failed", ["unknown_stage"]);
      }
    } catch (error) {
      const message = errorMessage(error).slice(0, 500);
      const terminal =
        draft.attemptCount >= this.config.draftWorker.maxAttempts;
      await this.repository.requeueOrFailV3({
        draftId: draft.id,
        conceptJson: {
          ...concept,
          pipeline: {
            ...concept.pipeline,
            state: terminal ? "failed" : "pending",
            reasonCodes: ["stage_execution_failed"],
          },
        } as Prisma.InputJsonValue,
        message,
        terminal,
      });
      this.logger.error(
        `V3 draft ${draft.id} ${String(stage)} failed: ${message}`,
      );
    }
  }

  private async runPostPlanning(
    draft: PlannedDraft,
    concept: V3Concept,
    client: StrictJsonAgentClient,
  ): Promise<void> {
    const input = postPlannerInput(draft, concept);
    const missing = [
      ...(input.persona.writingProfile.contentStyle.length
        ? []
        : ["content_style"]),
      ...(input.persona.writingProfile.voice.length ? [] : ["voice"]),
    ];
    if (missing.length) {
      await this.pause(
        draft,
        concept,
        "needs_input",
        missing.map((value) => `missing_${value}`),
      );
      return;
    }
    const result = await new PostPlanningAgent(client).plan(input, {
      requestId: draft.id,
      characterId: draft.characterId,
      metadata: {
        pipelineVersion: "post-pipeline-v3",
        stage: "post_plan",
        promptVersion: POST_PLANNER_PROMPT_VERSION,
      },
    });
    const revision = artifactRevision(concept.postPlanning) + 1;
    const hash = canonicalJsonHash(result.output);
    const artifact = {
      revision,
      hash,
      producerLogId: result.producerLogId,
      contractVersion: POST_PLAN_CONTRACT_VERSION,
      promptVersion: POST_PLANNER_PROMPT_VERSION,
      input,
      output: result.output,
    };
    if (result.output.status === "conflict") {
      await this.repository.persistV3Paused({
        draftId: draft.id,
        characterId: draft.characterId,
        expectedStage: "post_plan",
        conceptJson: {
          ...concept,
          postPlanning: artifact,
          pipeline: {
            ...concept.pipeline,
            state: "conflict",
            reasonCodes: ["semantic_conflict"],
          },
        } as Prisma.InputJsonValue,
        reason: "Post Planning Agent returned conflict",
      });
      return;
    }
    const max = Math.max(1, Math.min(this.config.draftWorker.maxShots, 3));
    const imageCount =
      existingImageCount(concept) ??
      Math.min(max, Math.floor(this.random() * max) + 1);
    const memoryCandidates = result.output.newMemoryCandidates.map(
      (candidate) => ({
        key: canonicalJsonHash(candidate),
        ...candidate,
        selected: concept.mode !== "manual",
        sourcePostPlanHash: hash,
      }),
    );
    const nextConcept = {
      ...concept,
      postPlanning: artifact,
      memoryCandidates,
      pipeline: {
        stage: "image_plan",
        state: "pending",
        imageCount,
        reasonCodes: [],
      },
    };
    const saved = await this.repository.persistV3Artifact({
      draftId: draft.id,
      characterId: draft.characterId,
      expected: {
        stage: "post_plan",
        state: "running",
        artifactKey: "postPlanning",
        revision: artifactRevision(concept.postPlanning) || null,
      },
      conceptJson: nextConcept as Prisma.InputJsonValue,
      actionType: "DRAFT_V3_POST_PLAN_READY",
      reason: `PostPlan revision ${revision} stored`,
    });
    if (!saved) throw new Error("post plan revision CAS lost");
  }

  private async runImagePlanning(
    draft: PlannedDraft,
    concept: V3Concept,
    client: StrictJsonAgentClient,
  ): Promise<void> {
    const postPlan = postPlanReady(concept);
    const imageCount = existingImageCount(concept);
    if (!postPlan || imageCount === null)
      throw new Error(
        "Image Planning requires a ready PostPlan and imageCount",
      );
    const availableLocations = await this.repository.findAvailableLocations(
      draft.characterId,
    );
    const input: ImagePlannerInput = {
      postPlan: { intent: postPlan.intent, caption: postPlan.caption },
      imageCount,
      characterVisualContext: {
        name: draft.character.displayName,
        appearance: draft.character.visualProfile?.appearancePrompt ?? "",
        visualStyle: draft.character.visualProfile?.stylePrompt ?? "",
        boundaries: personaContents(draft, "boundaries"),
        relevantContext: draft.character.personas
          .filter(
            (entry) =>
              ![
                "voice",
                "content_style",
                "boundaries",
                "greeting",
                "examples",
              ].includes(normalizeTitle(entry.title)),
          )
          .map((entry) => entry.content),
      },
      ...(operatorRequest(concept)
        ? { operatorRequest: operatorRequest(concept) }
        : {}),
      identityReferences: (draft.character.visualProfile?.referenceMedia ?? [])
        .filter(
          (reference) =>
            reference.description.trim() && reference.media.uploadedAt,
        )
        .map((reference) => ({
          id: reference.mediaId,
          description: reference.description,
        })),
      locations: availableLocations.map((location) => ({
        id: location.id,
        name: location.displayName,
        description: location.description,
        references: location.references
          .filter((reference) => reference.media.uploadedAt)
          .map((reference) => ({
            id: reference.mediaId,
            description: reference.description,
          })),
      })),
    };
    const result = await new ImagePlanningAgent(client).plan(input, {
      requestId: draft.id,
      characterId: draft.characterId,
      metadata: {
        pipelineVersion: "post-pipeline-v3",
        stage: "image_plan",
        promptVersion: IMAGE_PLANNER_PROMPT_VERSION,
      },
    });
    if (result.output.status === "blocked") {
      const onlyInsufficient = result.output.reasons.every(
        (reason) => reason.code === "insufficient_distinct_shots",
      );
      if (onlyInsufficient && imageCount > 1) {
        const adjusted = {
          ...concept,
          pipeline: {
            ...concept.pipeline,
            state: "pending",
            imageCount: imageCount - 1,
            reasonCodes: ["image_count_reduced"],
          },
        };
        const saved = await this.repository.persistV3Artifact({
          draftId: draft.id,
          characterId: draft.characterId,
          expected: {
            stage: "image_plan",
            state: "running",
            artifactKey: "imagePlanning",
            revision: artifactRevision(concept.imagePlanning) || null,
          },
          conceptJson: adjusted as Prisma.InputJsonValue,
          actionType: "DRAFT_V3_IMAGE_COUNT_REDUCED",
          reason: `imageCount reduced from ${imageCount} to ${imageCount - 1}`,
        });
        if (!saved) throw new Error("imageCount revision CAS lost");
        return;
      }
      const revision = artifactRevision(concept.imagePlanning) + 1;
      const hash = canonicalJsonHash(result.output);
      await this.repository.persistV3Paused({
        draftId: draft.id,
        characterId: draft.characterId,
        expectedStage: "image_plan",
        conceptJson: {
          ...concept,
          imagePlanning: imageArtifact(
            revision,
            hash,
            result.producerLogId,
            concept,
            input,
            result.output,
          ),
          pipeline: {
            ...concept.pipeline,
            state: "blocked",
            reasonCodes: result.output.reasons.map((reason) => reason.code),
          },
        } as Prisma.InputJsonValue,
        reason: `Image Planning blocked: ${result.output.reasons.map((reason) => reason.code).join(",")}`,
      });
      return;
    }
    const revision = artifactRevision(concept.imagePlanning) + 1;
    const hash = canonicalJsonHash(result.output);
    const nextConcept = {
      ...concept,
      imagePlanning: imageArtifact(
        revision,
        hash,
        result.producerLogId,
        concept,
        input,
        result.output,
      ),
      pipeline: {
        ...concept.pipeline,
        stage: "image_prompt",
        state: "pending",
        reasonCodes: [],
      },
    };
    const saved = await this.repository.persistV3Artifact({
      draftId: draft.id,
      characterId: draft.characterId,
      expected: {
        stage: "image_plan",
        state: "running",
        artifactKey: "imagePlanning",
        revision: artifactRevision(concept.imagePlanning) || null,
      },
      conceptJson: nextConcept as Prisma.InputJsonValue,
      actionType: "DRAFT_V3_IMAGE_PLAN_READY",
      reason: `ImagePlan revision ${revision} stored`,
    });
    if (!saved) throw new Error("image plan revision CAS lost");
  }

  private async runPromptGeneration(
    draft: PlannedDraft,
    concept: V3Concept,
    client: StrictJsonAgentClient,
  ): Promise<void> {
    const postPlan = postPlanReady(concept);
    const imagePlan = imagePlanReady(concept);
    if (!postPlan || !imagePlan)
      throw new Error("Prompt Generation requires ready upstream artifacts");
    const providers = await this.settings.resolveProviderSettings();
    const usesReferences = imagePlan.shots.some(
      (shot) => shot.referenceBindings.length > 0,
    );
    const targetModelId = usesReferences
      ? providers.editModel
      : providers.t2iModel;
    if (!targetModelId) {
      await this.pause(draft, concept, "needs_configuration", [
        usesReferences ? "edit_model_missing" : "t2i_model_missing",
      ]);
      return;
    }
    let promptPackage;
    try {
      promptPackage = buildPromptPackage({
        targetModelId,
        imagePlan,
        appearance: draft.character.visualProfile?.appearancePrompt ?? "",
        visualStyle: draft.character.visualProfile?.stylePrompt,
        exclusions: [draft.character.visualProfile?.negativePrompt ?? ""],
      });
    } catch (error) {
      if (error instanceof UnsupportedImagePlanError) {
        await this.pause(draft, concept, "unsupported_plan", [error.code]);
        return;
      }
      throw error;
    }
    const result = await new ImagePromptGenerationAgent(client).generate(
      promptPackage,
      {
        requestId: draft.id,
        characterId: draft.characterId,
        metadata: {
          pipelineVersion: "post-pipeline-v3",
          stage: "image_prompt",
          promptVersion: IMAGE_PROMPT_GENERATOR_VERSION,
          modelPolicyVersion: promptPackage.modelPolicy.version,
        },
      },
    );
    const revision = artifactRevision(concept.promptBuild) + 1;
    const hash = canonicalJsonHash(result.output);
    const artifact = {
      revision,
      hash,
      source: {
        imagePlanningRevision: artifactRevision(concept.imagePlanning),
        imagePlanningHash: artifactHash(concept.imagePlanning),
      },
      producerLogId: result.producerLogId,
      contractVersion: PROMPT_SET_CONTRACT_VERSION,
      commonPromptVersion: IMAGE_PROMPT_GENERATOR_VERSION,
      modelPolicy: {
        id: promptPackage.modelPolicy.id,
        version: promptPackage.modelPolicy.version,
      },
      input: promptPackage,
      output: result.output,
    };
    const nextConcept = {
      ...concept,
      promptBuild: artifact,
      pipeline: {
        ...concept.pipeline,
        stage: "generation",
        state: "ready",
        reasonCodes: [],
      },
    };
    const saved = await this.repository.persistV3PromptJobs({
      draftId: draft.id,
      characterId: draft.characterId,
      caption: postPlan.caption,
      hashtags: postPlan.hashtags,
      locationId: imagePlan.locationId,
      conceptJson: nextConcept as Prisma.InputJsonValue,
      manual: concept.mode === "manual",
      jobs: result.output.shots.map((shot) => {
        const plannedShot = imagePlan.shots[shot.sortOrder];
        const slots = promptPackage.referenceSlots.filter(
          (slot) => slot.shotSortOrder === shot.sortOrder,
        );
        const identityReferenceMediaIds = slots
          .filter((slot) => slot.source === "identity")
          .map((slot) => slot.referenceId);
        const environmentReferenceMediaIds = slots
          .filter((slot) => slot.source === "environment")
          .map((slot) => slot.referenceId);
        return {
          prompt: shot.prompt,
          sortOrder: shot.sortOrder,
          paramsJson: {
            _shot: {
              sortOrder: shot.sortOrder,
              scene: plannedShot.scene,
              captureSetup: plannedShot.captureSetup,
              characterVisible:
                plannedShot.characterPresentation.mode !== "none",
              identityReferenceMediaIds,
              environmentReferenceMediaIds,
              referenceMediaIds: slots.map((slot) => slot.referenceId),
              targetModelId,
            },
            _v3: {
              imagePlanningRevision: artifactRevision(concept.imagePlanning),
              imagePlanningHash: artifactHash(concept.imagePlanning),
              promptRevision: revision,
              promptHash: hash,
              referenceBindings: slots.map((slot) => ({
                bindingId: slot.bindingId,
                referenceId: slot.referenceId,
                slot: slot.slot,
              })),
              negativePrompt: shot.negativePrompt,
            },
          } as Prisma.InputJsonValue,
        };
      }),
    });
    if (!saved) throw new Error("prompt revision CAS lost");
  }

  private async pause(
    draft: PlannedDraft,
    concept: V3Concept,
    state: string,
    reasonCodes: string[],
  ): Promise<void> {
    await this.repository.persistV3Paused({
      draftId: draft.id,
      characterId: draft.characterId,
      expectedStage: String(concept.pipeline.stage),
      conceptJson: {
        ...concept,
        pipeline: { ...concept.pipeline, state, reasonCodes },
      } as Prisma.InputJsonValue,
      reason: `${state}: ${reasonCodes.join(",")}`,
    });
  }
}

function postPlannerInput(
  draft: PlannedDraft,
  concept: V3Concept,
): PostPlannerInput {
  const personas = draft.character.personas.filter((entry) =>
    entry.content.trim(),
  );
  const take = (title: string) =>
    personas.filter((entry) => normalizeTitle(entry.title) === title);
  const reserved = new Set([
    "identity",
    "personality",
    "background",
    "lifestyle",
    "voice",
    "content_style",
    "boundaries",
    "greeting",
    "examples",
  ]);
  return {
    character: {
      name: draft.character.displayName,
      bio: draft.character.bio,
      interests: draft.character.interests,
      defaultContentLanguage: draft.character.contentLanguage,
    },
    persona: {
      characterContext: personas.filter((entry) =>
        ["identity", "personality", "background", "lifestyle"].includes(
          normalizeTitle(entry.title),
        ),
      ),
      writingProfile: {
        contentStyle: take("content_style"),
        voice: take("voice"),
      },
      boundaries: take("boundaries"),
      additionalContext: personas.filter(
        (entry) => !reserved.has(normalizeTitle(entry.title)),
      ),
    },
    memories: draft.character.memories.map((memory) => ({
      type: memory.type,
      content: memory.content,
    })),
    recentPosts: draft.character.posts.map((post) => ({
      premise: recentPremise(post.sourceDrafts[0]?.conceptJson),
      caption: post.content,
      hashtags: post.hashtags.map((relation) => relation.hashtag.name),
    })),
    ...(operatorRequest(concept)
      ? { operatorRequest: operatorRequest(concept) }
      : {}),
  };
}

function imageArtifact(
  revision: number,
  hash: string,
  producerLogId: string | null,
  concept: V3Concept,
  input: ImagePlannerInput,
  output: unknown,
) {
  return {
    revision,
    hash,
    source: {
      postPlanningRevision: artifactRevision(concept.postPlanning),
      postPlanningHash: artifactHash(concept.postPlanning),
    },
    producerLogId,
    contractVersion: IMAGE_PLAN_CONTRACT_VERSION,
    promptVersion: IMAGE_PLANNER_PROMPT_VERSION,
    input,
    output,
  };
}

function postPlanReady(concept: V3Concept): PostPlanReady | null {
  const artifact = isRecord(concept.postPlanning) ? concept.postPlanning : null;
  const output = artifact && isRecord(artifact.output) ? artifact.output : null;
  return output?.status === "ready" ? (output as PostPlanReady) : null;
}
function imagePlanReady(concept: V3Concept): ImagePlanReady | null {
  const artifact = isRecord(concept.imagePlanning)
    ? concept.imagePlanning
    : null;
  const output = artifact && isRecord(artifact.output) ? artifact.output : null;
  return output?.status === "ready" ? (output as ImagePlanReady) : null;
}
function artifactRevision(value: unknown): number {
  return isRecord(value) && Number.isInteger(value.revision)
    ? (value.revision as number)
    : 0;
}
function artifactHash(value: unknown): string {
  return isRecord(value) && typeof value.hash === "string" ? value.hash : "";
}
function existingImageCount(concept: V3Concept): number | null {
  const value = concept.pipeline.imageCount;
  return Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 3
    ? (value as number)
    : null;
}
function operatorRequest(concept: V3Concept): string | undefined {
  return typeof concept.operatorRequest === "string" &&
    concept.operatorRequest.trim()
    ? concept.operatorRequest.trim()
    : undefined;
}
function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[ -]+/g, "_");
}
function personaContents(draft: PlannedDraft, title: string): string[] {
  return draft.character.personas
    .filter((entry) => normalizeTitle(entry.title) === title)
    .map((entry) => entry.content);
}
function recentPremise(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const v3 =
    isRecord(value.postPlanning) &&
    isRecord(value.postPlanning.output) &&
    isRecord(value.postPlanning.output.intent)
      ? value.postPlanning.output.intent.premise
      : undefined;
  if (typeof v3 === "string" && v3.trim()) return v3.trim();
  const legacy =
    isRecord(value.plan) && isRecord(value.plan.intent)
      ? value.plan.intent.premise
      : undefined;
  return typeof legacy === "string" && legacy.trim() ? legacy.trim() : null;
}
