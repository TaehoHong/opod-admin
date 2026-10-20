import { currentReferenceOutputs } from "./reference-post-artifacts";
export { currentReferenceOutputs } from "./reference-post-artifacts";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { resolveImageGenerationParams } from "../generation/image-generation-params";
import { resolveImageModelPolicy } from "./image-model-policy";
import {
  VisualCompositionService,
  MatchedCharacterVisual,
} from "../characters/visual-composition.service";
import { CompositionAnalysis } from "../shared/ai/image-composition";
import type { DraftsService } from "../drafts/drafts.service";
import { GenerationService } from "../generation/generation.service";
import { CharacterContentProfileService } from "../character-content-profiles/character-content-profile.service";
import { VisualProfileService } from "../characters/visual-profile.service";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { isRecord } from "../shared/utils/value-utils";
import { generationSetHash, canonicalJsonHash } from "./post-pipeline-v3";
import {
  ConfiguredReferenceAgentConfig,
  ReferenceAgentStageConfig,
} from "./reference-agent-config";
import { InfluencerReferenceRetrievalService } from "./influencer-reference-retrieval.service";
import { MediaBytesReader } from "./reference-captioner";
import { ReferenceSelectionAgent } from "./reference-selection-agent";
import { selectReferences } from "./reference-selection";
import {
  ReferenceImagePromptAgent,
  ReferenceImagePromptInput,
  ReferencePromptShot,
} from "./reference-image-prompt";
import {
  CaptionWriterAgent,
  ReferenceCaptionWriterInput,
  groupReferenceSourceCaptions,
} from "./caption-writer";

type Concept = Record<string, unknown>;
type SelectionShot = {
  shotId: string;
  sortOrder: number;
  mediaId: string;
  influencerId: string;
  postId: string;
  slideIndex: number;
  mediaKey: string;
  sha256: string;
  sourceCaption: string | null;
  sourceComposition?: CompositionAnalysis;
  visualReferences?: MatchedCharacterVisual[];
  visualMatching?: unknown;
};
type PromptArtifact = {
  revision: number;
  generationParams: Record<string, unknown>;
  input: ReferenceImagePromptInput;
  output: { status: "ready"; shots: ReferencePromptShot[] };
};
export type ReferenceCaptionContext = Pick<
  ReferenceCaptionWriterInput,
  "character" | "persona"
>;

// This coordinator only composes public domain services. Generation jobs remain
// owned by GenerationService, including idempotent creation and queueing.
export class ReferencePostAgentRunner {
  constructor(
    private readonly drafts: DraftsService,
    private readonly generation: GenerationService,
    private readonly profiles: CharacterContentProfileService,
    private readonly visuals: VisualProfileService,
    private readonly retrieval: InfluencerReferenceRetrievalService,
    private readonly createClient: (
      config: ReferenceAgentStageConfig,
    ) => Promise<StrictJsonAgentClient>,
    private readonly readBytes: MediaBytesReader,
    private readonly settings: GenerationSettingsService,
    private readonly captionContext: (
      characterId: string,
    ) => Promise<ReferenceCaptionContext>,
    private readonly compositions: VisualCompositionService,
  ) {}

  async runCurrentStage(draftId: string): Promise<void> {
    const { draft } = await this.drafts.getReferenceDraftState(draftId);
    const concept = draft.conceptJson as Concept;
    const pipeline = record(concept.pipeline);
    if (draft.status !== "generating" && draft.status !== "regenerating")
      return;
    const config =
      concept.referenceAgentConfig as ConfiguredReferenceAgentConfig;
    if (!config?.revision || !config.stages || !config.generation)
      throw new Error("reference_agent_config_required");
    const stage = pipeline.stage;
    if (stage === "generation") {
      await this.startGeneration(draftId, draft.characterId, concept, config);
      return;
    }
    if (
      stage !== "reference_select" &&
      stage !== "image_prompt" &&
      stage !== "caption"
    )
      throw new Error("reference_stage_invalid");
    const client = await this.createClient(config.stages[stage]);
    const profile = await this.profiles.get(draft.characterId);
    const input = {
      character: {
        concept: profile.accountConcept,
        imageStyle: profile.imageStyle,
        constraints: profile.constraints,
      },
      ...(typeof concept.operatorRequest === "string"
        ? { operatorRequest: concept.operatorRequest }
        : {}),
    };
    const context = { requestId: draftId, characterId: draft.characterId };
    if (stage === "reference_select") {
      const usedSources = await this.drafts.getPublishedReferenceSources(
        draft.characterId,
      );
      const logs: (string | null)[] = [];
      const selected = await selectReferences(
        {
          retrieveCandidates: async ({
            limit,
            excludedMediaIds,
            excludedSha256,
          }) =>
            this.retrieval.retrieve({
              characterId: draft.characterId,
              requestId: draftId,
              accountConcept: profile.accountConcept,
              imageStyle: profile.imageStyle,
              constraints: profile.constraints,
              operatorRequest: input.operatorRequest,
              usedSources,
              excludedMediaIds,
              excludedSha256s: excludedSha256,
              limit,
            }),
          selectCandidates: async (candidates) => {
            const result = await new ReferenceSelectionAgent(
              client,
              this.readBytes,
            ).select(
              input,
              candidates.map((candidate) => ({
                ...candidate,
                media: { url: "", storageKey: candidate.mediaKey },
              })),
              context,
            );
            logs.push(result.producerLogId);
            return result.output;
          },
        },
        { maxAttempts: config.selection.maxAttempts },
      );
      if (selected.status !== "selected") {
        await this.save(draftId, concept, {
          referenceSelection: {
            status: selected.status,
            attempts: selected.attempts,
            producerLogIds: logs,
            configRevision: config.revision,
          },
          pipeline: {
            ...pipeline,
            state: "needs_input",
            blockers: [selected.status],
          },
        });
        return;
      }
      const shots: SelectionShot[] = selected.selectedCandidates.map(
        (source, index) => ({
          ...source,
          shotId: `SHOT_${String(index + 1).padStart(2, "0")}`,
          sortOrder: index,
        }),
      );
      const matchedShots = await this.matchVisuals(
        draft.characterId,
        shots,
        config,
        client,
        context,
      );
      await this.save(draftId, concept, {
        referenceSelection: {
          revision:
            typeof concept.referenceRevision === "number"
              ? concept.referenceRevision
              : 1,
          status: "selected",
          shots: matchedShots,
          inputHash: canonicalJsonHash({ input, usedSources }),
          configRevision: config.revision,
          producerLogIds: logs,
        },
        pipeline: { ...pipeline, stage: "image_prompt", state: "ready" },
      });
      return;
    }
    const shots = (record(concept.referenceSelection).shots ??
      []) as SelectionShot[];
    if (stage === "image_prompt") {
      const sources = await this.retrieval.findReadSources(
        draft.characterId,
        shots,
      );
      const visual = await this.visuals.getProfile(draft.characterId);
      const policy = resolveImageModelPolicy(config.generation.effectiveModel);
      if (!policy.supportsReferences)
        throw new Error("reference_model_not_supported");
      // Old drafts may already have selected sources but no character bindings.
      const boundShots = shots.every(
        (shot) =>
          Array.isArray(shot.visualReferences) && shot.sourceComposition,
      )
        ? shots
        : await this.matchVisuals(
            draft.characterId,
            shots,
            config,
            await this.createClient(config.stages.reference_select),
            context,
          );
      for (const shot of boundShots) {
        if (1 + shot.visualReferences!.length > policy.maxReferencesPerShot)
          throw new Error(
            `reference_model_limit_exceeded: ${1 + shot.visualReferences!.length}/${policy.maxReferencesPerShot}`,
          );
      }
      const ratios = await this.settings.resolveAspectRatios();
      const generationParams = resolveImageGenerationParams(
        draft,
        {
          feed: ratios.feed.value,
          reel: ratios.reel.value,
          story: ratios.story.value,
        },
        visual.providerConfig,
      );
      const promptInput: ReferenceImagePromptInput = {
        ...input,
        shots: boundShots.map((shot, index) => ({
          shotId: shot.shotId,
          personCount: shot.sourceComposition!.content.personCount,
          references: [
            ...shot.visualReferences!,
            {
              id: `SOURCE_${index + 1}`,
              role: "source" as const,
              sha256: shot.sha256,
              media: { url: "", storageKey: sources[index].mediaKey },
            },
          ].map((reference, order) => ({
            ...reference,
            inputOrder: order + 1,
            promptLabel: `${policy.referenceSlotPrefix} ${order + 1}`,
          })),
        })),
      };
      const result = await new ReferenceImagePromptAgent(
        client,
        this.readBytes,
      ).build(promptInput, context);
      await this.save(draftId, concept, {
        referenceSelection: {
          ...record(concept.referenceSelection),
          shots: boundShots,
        },
        promptBuild: {
          revision:
            typeof concept.referenceRevision === "number"
              ? concept.referenceRevision
              : 1,
          generationParams,
          input: promptInput,
          output: result.output,
          inputHash: canonicalJsonHash(promptInput),
          configRevision: config.revision,
          producerLogId: result.producerLogId,
        },
        pipeline: {
          ...pipeline,
          stage: result.output.status === "ready" ? "generation" : stage,
          state: result.output.status === "ready" ? "ready" : "needs_input",
        },
      });
      return;
    }
    const { jobs } = await this.drafts.getReferenceDraftState(draftId);
    const generated = currentReferenceOutputs(concept, jobs);
    if (!generated) throw new Error("reference_generation_incomplete");
    const captionInput: ReferenceCaptionWriterInput = {
      kind: "reference",
      ...(await this.captionContext(draft.characterId)),
      contentProfile: profile,
      operatorRequest: input.operatorRequest,
      generatedShots: generated.map((shot) => ({
        shotId: shot.shotId,
        sortOrder: shot.sortOrder,
        mediaId: shot.mediaId,
      })),
      sourceCaptions: groupReferenceSourceCaptions(
        shots.map((shot) => ({ ...shot, sourceUrl: null })),
      ),
    };
    const result = await new CaptionWriterAgent(client, this.readBytes).write(
      captionInput,
      generated,
      context,
    );
    await this.drafts.saveReferenceStage({
      draftId,
      expectedConceptJson: concept,
      conceptJson: {
        ...concept,
        captionBuild: {
          revision:
            typeof concept.referenceRevision === "number"
              ? concept.referenceRevision
              : 1,
          input: captionInput,
          source: {
            generationSetHash: generationSetHash(
              generated.map((shot, index) => ({
                sortOrder: shot.sortOrder,
                jobId: (record(concept.generationBuild).jobIds as string[])[
                  index
                ],
                mediaId: shot.mediaId,
              })),
            ),
            promptBuildRevision: record(concept.promptBuild).revision,
          },
          inputHash: canonicalJsonHash({ captionInput, generated }),
          configRevision: config.revision,
          producerLogId: result.producerLogId,
          output: result.output,
        },
        pipeline: { ...pipeline, state: "ready" },
      },
      status: "needs_review",
      caption: result.output.caption,
      hashtags: result.output.hashtags,
      expectedOutputs: generated.map((shot, index) => ({
        jobId: (record(concept.generationBuild).jobIds as string[])[index],
        mediaId: shot.mediaId,
      })),
    });
  }

  private async startGeneration(
    draftId: string,
    characterId: string,
    concept: Concept,
    config: ConfiguredReferenceAgentConfig,
  ) {
    const prompt = concept.promptBuild as PromptArtifact;
    if (prompt?.output?.status !== "ready")
      throw new Error("reference_prompt_required");
    const current = record(concept.generationBuild);
    if (
      Array.isArray(current.jobIds) &&
      current.promptRevision === prompt.revision
    ) {
      const { jobs } = await this.drafts.getReferenceDraftState(draftId);
      for (const job of jobs)
        if (current.jobIds.includes(job.id) && job.status === "draft")
          await this.generation.confirmImageDraft(job.id);
      return;
    }
    const result = await this.generation.ensureReferenceDraftJobs({
      draftId,
      characterId,
      promptRevision: String(prompt.revision),
      shots: prompt.output.shots.map((shot, index) => ({
        ...shot,
        sortOrder: index,
        references: prompt.input.shots[index].references.map((reference) => ({
          ...reference,
          sha256: reference.sha256!,
        })),
        generation: config.generation,
        generationParams: prompt.generationParams,
      })),
    });
    const saved = await this.save(draftId, concept, {
      generationBuild: {
        jobIds: result.jobIds,
        promptRevision: prompt.revision,
        configRevision: config.revision,
        inputHash: canonicalJsonHash(prompt),
      },
      pipeline: { ...record(concept.pipeline), state: "running" },
    });
    if (saved)
      for (const jobId of result.jobIds)
        await this.generation.confirmImageDraft(jobId);
  }

  async aggregateGeneration(draftId: string): Promise<boolean> {
    let { draft, jobs } = await this.drafts.getReferenceDraftState(draftId);
    let concept = draft.conceptJson as Concept;
    if (record(concept.pipeline).stage !== "generation") return false;
    if (
      draft.status &&
      !["generating", "regenerating", "failed"].includes(draft.status)
    )
      return false;
    const build = record(concept.generationBuild);
    const revision = record(concept.promptBuild).revision;
    if (
      !Array.isArray(build.jobIds) ||
      !build.jobIds.length ||
      build.promptRevision !== revision ||
      build.jobIds.some(
        (id) =>
          !jobs.some(
            (job) =>
              job.id === id &&
              record(record(job.paramsJson)._referenceAgent).promptRevision ===
                String(revision),
          ),
      )
    )
      return false;

    if (
      Array.isArray(build.jobIds) &&
      jobs.some(
        (job) =>
          (build.jobIds as string[]).includes(job.id) &&
          job.status === "failed",
      )
    ) {
      return this.save(draftId, concept, {
        pipeline: {
          ...record(concept.pipeline),
          state: "failed",
          blockers: ["reference_generation_failed"],
        },
      });
    }
    if (draft.status === "failed") {
      if (!(await this.drafts.restoreReferenceGeneration(draftId, concept)))
        return false;
      ({ draft, jobs } = await this.drafts.getReferenceDraftState(draftId));
      concept = draft.conceptJson as Concept;
    }
    const activeBuild = record(concept.generationBuild);
    const promptRevision = record(concept.promptBuild).revision;
    if (
      !Array.isArray(activeBuild.jobIds) ||
      activeBuild.promptRevision !== promptRevision
    )
      return false;
    for (const job of jobs) {
      const marker = record(record(job.paramsJson)._referenceAgent);
      if (
        activeBuild.jobIds.includes(job.id) &&
        marker.promptRevision === String(promptRevision) &&
        job.status === "draft"
      )
        await this.generation.confirmImageDraft(job.id);
    }
    if (!currentReferenceOutputs(concept, jobs)) return false;
    return this.save(draftId, concept, {
      pipeline: {
        ...record(concept.pipeline),
        stage: "caption",
        state: "ready",
      },
    });
  }

  private async matchVisuals(
    characterId: string,
    shots: SelectionShot[],
    config: ConfiguredReferenceAgentConfig,
    client: StrictJsonAgentClient,
    context: { requestId: string; characterId: string },
  ): Promise<SelectionShot[]> {
    const policy = resolveImageModelPolicy(config.generation.effectiveModel);
    if (!policy.supportsReferences)
      throw new Error("reference_model_not_supported");
    const sources = await this.retrieval.findReadSources(characterId, shots);
    const bound: SelectionShot[] = [];
    for (const [index, shot] of shots.entries()) {
      const result = await this.compositions.match({
        characterId,
        source: sources[index],
        maxReferences: policy.maxReferencesPerShot - 1,
        slotPrefix: policy.referenceSlotPrefix,
        client,
        context,
      });
      bound.push({
        ...shot,
        sourceComposition: result.sourceAnalysis,
        visualReferences: result.references,
        visualMatching: result.trace,
      });
    }
    return bound;
  }

  private save(draftId: string, expected: Concept, changes: Concept) {
    return this.drafts.saveReferenceStage({
      draftId,
      expectedConceptJson: expected,
      conceptJson: { ...expected, ...changes },
    });
  }
}
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
