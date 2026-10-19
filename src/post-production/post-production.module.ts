import { AiModelsModule } from "../ai-models/ai-models.module";
import { AiModelService } from "../ai-models/ai-model.service";
import { DraftsModule } from "../drafts/drafts.module";
import { DraftsService } from "../drafts/drafts.service";
import { GenerationModule } from "../generation/generation.module";
import { GenerationService } from "../generation/generation.service";
import { InfluencersModule } from "../influencers/influencers.module";
import { CharacterInfluencerService } from "../influencers/character-influencer.service";
import { InfluencerMediaService } from "../influencers/influencer-media.service";
import { InfluencerReferenceRetrievalService } from "./influencer-reference-retrieval.service";
import { ReferencePostAgentRunner } from "./reference-post-agent.runner";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { ReferenceAgentGenerationConfig } from "./reference-agent-config";
import { AiSelection } from "../settings/ai-management";
import { CharacterService } from "../characters/character.service";
import { MemoryRetrievalService } from "./memory-retrieval.service";
import { CharactersModule } from "../characters/characters.module";
import { VisualProfileService } from "../characters/visual-profile.service";
import { LocationsModule } from "../locations/locations.module";
import { LocationsService } from "../locations/locations.service";
import { ReferenceRetrievalService } from "./reference-retrieval.service";
import { PostAgentPromptsModule } from "../post-agent-prompts/post-agent-prompts.module";
import { PostAgentPromptService } from "../post-agent-prompts/post-agent-prompt.service";
import { CharacterContentProfilesModule } from "../character-content-profiles/character-content-profiles.module";
import { CharacterContentProfileService } from "../character-content-profiles/character-content-profile.service";
import { Module } from "@nestjs/common";
import { S3Config } from "../core/config/app-config";
import { AppConfigService } from "../core/config/app-config.service";
import { DatabaseModule } from "../core/database/database.module";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { SettingsModule } from "../settings/settings.module";
import { resolveContentPlanner } from "./content-planner";
import { DraftWorkerService } from "../drafts/draft-worker.service";
import { DraftWorkerRepository } from "../drafts/draft-worker.repository";
import {
  createGeneratedMediaStore,
  createReferenceUrlSigner,
} from "../media/generated-media-store";
import { GenerationWorkerService } from "../generation/generation-worker.service";
import { GenerationJobRepository } from "../generation/generation-job.repository";
import { resolveImageGenerationProviders } from "../generation/providers/image-generation.provider";
import { resolveImagePromptBuilder } from "./image-prompt-builder";
import { createMediaBytesReader } from "./reference-captioner";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { PostPipelineV3Runner } from "./post-pipeline-v3.runner";

function storageEnv(config: S3Config | undefined) {
  return config
    ? {
        S3_BUCKET: config.bucket,
        AWS_REGION: config.region,
        AWS_ACCESS_KEY_ID: config.accessKeyId,
        AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
        S3_PUBLIC_BASE_URL: config.publicBaseUrl,
      }
    : {};
}

// 미디어 생성/드래프트 워커. 당분간 opod-admin 프로세스에서 함께 실행한다
// (docs/media-generation-pipeline.md D1). admin HTTP 모듈에 대한 역참조를
// 두지 않는다 — 추후 별도 이미지 분리 시 엔트리포인트만 추가하면 되는 구조 유지.
@Module({
  imports: [
    AiModelsModule,
    CharactersModule,
    DraftsModule,
    GenerationModule,
    InfluencersModule,
    LocationsModule,
    DatabaseModule,
    SettingsModule,
    CharacterContentProfilesModule,
    PostAgentPromptsModule,
  ],
  providers: [
    {
      provide: InfluencerReferenceRetrievalService,
      useFactory: (
        links: CharacterInfluencerService,
        media: InfluencerMediaService,
        settings: GenerationSettingsService,
        logs: LlmLogService,
      ) =>
        new InfluencerReferenceRetrievalService(links, media, settings, logs),
      inject: [
        CharacterInfluencerService,
        InfluencerMediaService,
        GenerationSettingsService,
        LlmLogService,
      ],
    },
    {
      provide: ReferencePostAgentRunner,
      useFactory: (
        drafts: DraftsService,
        generation: GenerationService,
        profiles: CharacterContentProfileService,
        visuals: VisualProfileService,
        retrieval: InfluencerReferenceRetrievalService,
        settings: GenerationSettingsService,
        logs: LlmLogService,
        config: AppConfigService,
        characters: CharacterService,
      ) =>
        new ReferencePostAgentRunner(
          drafts,
          generation,
          profiles,
          visuals,
          retrieval,
          async (stage) => {
            const transport = await settings.resolvePlannerSettings();
            if (
              stage.provider !== "openai-compatible" ||
              !transport.apiUrl ||
              !transport.apiKey
            )
              throw new Error("reference_llm_connection_not_configured");
            return new StrictJsonAgentClient(
              {
                apiUrl: transport.apiUrl,
                apiKey: transport.apiKey,
                model: stage.model,
              },
              fetch,
              logs,
              {
                systemPrompt: stage.systemPrompt,
                outputSchema: stage.outputSchema,
                metadata: {
                  aiModelId: stage.aiModelId,
                  provider: stage.provider,
                  effectiveModel: stage.model,
                },
              },
            );
          },
          createMediaBytesReader(config.s3),
          settings,
          (characterId) => characters.getReferenceCaptionContext(characterId),
        ),
      inject: [
        DraftsService,
        GenerationService,
        CharacterContentProfileService,
        VisualProfileService,
        InfluencerReferenceRetrievalService,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
        CharacterService,
      ],
    },
    {
      provide: MemoryRetrievalService,
      useFactory: (
        characters: CharacterService,
        settings: GenerationSettingsService,
        logs: LlmLogService,
      ) => new MemoryRetrievalService(characters, settings, logs),
      inject: [CharacterService, GenerationSettingsService, LlmLogService],
    },
    {
      provide: ReferenceRetrievalService,
      useFactory: (
        visual: VisualProfileService,
        locations: LocationsService,
        settings: GenerationSettingsService,
        logs: LlmLogService,
      ) => new ReferenceRetrievalService(visual, locations, settings, logs),
      inject: [
        VisualProfileService,
        LocationsService,
        GenerationSettingsService,
        LlmLogService,
      ],
    },
    GenerationJobRepository,
    DraftWorkerRepository,
    {
      provide: PostPipelineV3Runner,
      useFactory: (
        drafts: DraftWorkerRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
        profiles: CharacterContentProfileService,
        agentPrompts: PostAgentPromptService,
        references: ReferenceRetrievalService,
        memories: MemoryRetrievalService,
        locations: LocationsService,
      ) =>
        new PostPipelineV3Runner(
          drafts,
          settings,
          llmLogs,
          config,
          profiles,
          Math.random,
          fetch,
          createMediaBytesReader(config.s3),
          agentPrompts,
          references,
          memories,
          locations,
        ),
      inject: [
        DraftWorkerRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
        CharacterContentProfileService,
        PostAgentPromptService,
        ReferenceRetrievalService,
        MemoryRetrievalService,
        LocationsService,
      ],
    },
    {
      provide: GenerationWorkerService,
      // 프로바이더는 잡 처리 시마다 재해석 — admin 설정(DB)이 env보다 우선.
      useFactory: (
        jobs: GenerationJobRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
        agentPrompts: PostAgentPromptService,
        models: AiModelService,
      ) =>
        new GenerationWorkerService(
          jobs,
          async (
            promptId,
            aiSelection?: AiSelection,
            frozen?: ReferenceAgentGenerationConfig,
          ) => {
            if (frozen) {
              if (frozen.source === "model") {
                const model = await models.get(frozen.aiModelId);
                if (
                  model.type !== "image" ||
                  model.provider !== frozen.provider ||
                  model.model !== frozen.effectiveModel
                )
                  throw new Error("reference_generation_config_changed");
              } else {
                const version = await agentPrompts.getVersion(
                  "generation",
                  frozen.id,
                );
                if (
                  !version ||
                  version.revision !== frozen.revision ||
                  version.aiModelId !== frozen.aiModelId ||
                  version.provider !== frozen.provider ||
                  version.effectiveModel !== frozen.effectiveModel
                )
                  throw new Error("reference_generation_config_changed");
              }
              return resolveImageGenerationProviders(
                await settings.resolveImageModelSettings(
                  frozen.provider,
                  frozen.effectiveModel,
                ),
                fetch,
                llmLogs,
              );
            }
            if (aiSelection)
              return resolveImageGenerationProviders(
                await settings.resolveAiImage(aiSelection),
                fetch,
                llmLogs,
              );
            const selected = promptId
              ? await agentPrompts.getVersion("generation", promptId)
              : null;
            return resolveImageGenerationProviders(
              selected
                ? await settings.resolveImageModelSettings(
                    selected.provider!,
                    selected.effectiveModel!,
                  )
                : await settings.resolveProviderSettings(),
              fetch,
              llmLogs,
            );
          },
          createGeneratedMediaStore(storageEnv(config.s3)),
          async () =>
            (await settings.resolveWorkerToggles()).generation.enabled,
          config.worker,
          undefined,
          undefined,
          // 비공개 S3 레퍼런스를 프로바이더가 받을 수 있게 presigned URL로 서명.
          createReferenceUrlSigner(storageEnv(config.s3)) ?? undefined,
          llmLogs,
          // 워커는 값만 필요하다 — 출처(db/default)는 설정 화면 표시용이다.
          async () => {
            const ratios = await settings.resolveAspectRatios();
            return {
              feed: ratios.feed.value,
              story: ratios.story.value,
              reel: ratios.reel.value,
            };
          },
          createMediaBytesReader(config.s3),
        ),
      inject: [
        GenerationJobRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
        PostAgentPromptService,
        AiModelService,
      ],
    },
    {
      provide: DraftWorkerService,
      // 플래너도 기획 시마다 재해석 — admin 설정(DB)이 env보다 우선.
      useFactory: (
        drafts: DraftWorkerRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
        v3: PostPipelineV3Runner,
        reference: ReferencePostAgentRunner,
        draftService: DraftsService,
        characters: CharacterService,
        generationWorker: GenerationWorkerService,
      ) =>
        new DraftWorkerService(
          drafts,
          async () =>
            resolveContentPlanner(
              await settings.resolvePlannerSettings(),
              fetch,
              llmLogs,
            ),
          // 프롬프트 빌더는 기획 LLM 설정을 재사용한다 (캡셔너·위저드 전례).
          // 대상 모델은 edit 우선 — 레퍼런스 있는 캐릭터가 일반 경로.
          async () => {
            const [planner, provider] = await Promise.all([
              settings.resolvePlannerSettings(),
              settings.resolveProviderSettings(),
            ]);
            return resolveImagePromptBuilder(
              planner,
              {
                t2iModelId: provider.t2iModel ?? provider.editModel,
                editModelId: provider.editModel,
              },
              fetch,
              llmLogs,
            );
          },
          // draft 워커는 생성 워커와 같은 토글을 공유한다.
          async () =>
            (await settings.resolveWorkerToggles()).generation.enabled,
          config.draftWorker,
          undefined,
          // 게시 마감본 업로드/원본 읽기 — 생성 워커와 같은 스토어·서명자.
          createGeneratedMediaStore(storageEnv(config.s3)),
          createReferenceUrlSigner(storageEnv(config.s3)),
          undefined,
          undefined,
          async () => (await settings.resolvePipelineV3()).enabled,
          (draftId, options) => v3.runCurrentStage(draftId, options),
          () => settings.scheduledAgentConcept(),
          {
            drafts: draftService,
            runner: reference,
            runQueuedJob: (jobId) => generationWorker.runJobNow(jobId),
            assertCharacterActive: async (id) => {
              if ((await characters.getCharacter(id)).status !== "active")
                throw new Error("reference_character_inactive");
            },
          },
        ),
      inject: [
        DraftWorkerRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
        PostPipelineV3Runner,
        ReferencePostAgentRunner,
        DraftsService,
        CharacterService,
        GenerationWorkerService,
      ],
    },
  ],
  // admin의 수동 실행이 주입해 쓴다 — 생성(generation/worker/run), draft 즉시
  // 기획/게시(drafts/:id/plan, drafts/:id/publish).
  exports: [GenerationWorkerService, DraftWorkerService],
})
export class PostProductionModule {}
