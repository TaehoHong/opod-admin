import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
import { assertUploadedMediaRow } from "../media/media.service";
import {
  assertVisibleCharacterHasReference,
  ContentPlanner,
} from "../../worker/content-planner";
import {
  ImagePromptBuilder,
  localImagePromptBuilder,
  targetModelIdForShot,
} from "../../worker/image-prompt-builder";
import type { ImageGenerationProgress } from "../../worker/image-generation.provider";
import { randomUUID } from "node:crypto";
import {
  GenerationParams,
  GenerationParamsObject,
  GenerationParamsValue,
  GenerationRepository,
} from "./generation.repository";

type MediaType = "image" | "video";
type JobStatus = "draft" | "queued" | "running" | "completed" | "failed";

// 수동 start 경로에도 lease를 걸어, 워커 스윕이 방치된 running 잡을 회수할 수 있게 한다.
const MANUAL_START_LEASE_MS = 10 * 60 * 1000;

type OutputMedia = {
  mediaType: MediaType;
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

type OutputCandidate = {
  mediaId: string;
  url: string;
  candidateIndex: number;
  selected: boolean;
};

type GenerationJob = {
  id: string;
  characterId: string;
  mediaType: MediaType;
  prompt: string;
  inputPrompt?: string;
  // 위저드 LLM 장면 확장 결과 (paramsJson._wizard). 없으면 원문이 그대로 장면.
  expandedScene?: string;
  plannerName?: string;
  // paramsJson.aspect_ratio — 잡 단위 종횡비 오버라이드 (없으면 프로필 기본값).
  aspectRatio?: string;
  candidateCount?: number;
  status: JobStatus;
  outputMediaId?: string;
  provider?: string;
  providerProgress?: ImageGenerationProgress;
  attemptCount: number;
  // 초안 파이프라인 소속 컷이면 해당 초안 id (추적 링크용).
  draftId?: string;
  originJobId?: string;
  errorMessage?: string;
  costUsd?: string;
  outputMedia?: OutputMedia;
  outputs?: OutputCandidate[];
  generationContext?: {
    negativePrompt: string;
    referenceImageCount: number;
    route: "t2i" | "edit";
  };
  createdAt: string;
  updatedAt: string;
};

type PersistedOutputMedia = {
  mediaType: MediaType;
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

type PersistedJobOutput = {
  mediaId: string;
  candidateIndex: number;
  selected: boolean;
  media: { url: string };
};

type PersistedGenerationJob = Omit<
  GenerationJob,
  | "createdAt"
  | "updatedAt"
  | "outputMedia"
  | "outputs"
  | "provider"
  | "attemptCount"
  | "draftId"
  | "originJobId"
  | "errorMessage"
  | "costUsd"
  | "inputPrompt"
  | "expandedScene"
  | "plannerName"
  | "candidateCount"
  | "outputMediaId"
  | "generationContext"
> & {
  createdAt: Date;
  updatedAt: Date;
  provider?: string | null;
  attemptCount?: number | null;
  draftId?: string | null;
  originJobId?: string | null;
  errorMessage?: string | null;
  costUsd?: { toString(): string } | null;
  inputPrompt?: string | null;
  candidateCount?: number | null;
  outputMediaId?: string | null;
  paramsJson?: GenerationParamsValue | null;
  outputMedia: PersistedOutputMedia | null;
  outputs?: PersistedJobOutput[];
  character?: {
    visualProfile: {
      negativePrompt: string;
      referenceMedia: { media: { uploadedAt: Date | null } }[];
    } | null;
  };
};

type ImageProfile = {
  appearancePrompt?: string;
  stylePrompt?: string;
  negativePrompt: string;
  referenceMedia: { media: { uploadedAt: Date | null } }[];
};

@Injectable()
export class GenerationService {
  constructor(
    private readonly generation: GenerationRepository,
    // 위저드 장면 확장 플래너 — 자동(draft) 파이프라인의 기획 LLM과 동일한
    // 설정을 쓴다. null이면 LLM 미설정 — 운영자 원문을 그대로 장면으로 쓴다
    // (로컬 결정적 플래너로 대체하지 않는다: 위저드에서는 원문이 더 낫다).
    private readonly resolveScenePlanner: () => Promise<ContentPlanner | null> = async () =>
      null,
    // 이미지 프롬프트 빌더 — 자동 파이프라인과 동일 단계. 기본값은 결정적
    // 폴백(외모·장면·스타일 연결)이라 LLM 미설정 시 기존 동작과 같다.
    private readonly resolvePromptBuilder: () => Promise<ImagePromptBuilder> = async () =>
      localImagePromptBuilder,
  ) {}

  async createImageDraft(input: {
    characterId: string;
    inputPrompt: string;
    candidateCount: number;
    aspectRatio?: string;
  }): Promise<GenerationJob> {
    const candidateCount = this.parseCandidateCount(input.candidateCount);
    const inputPrompt = input.inputPrompt.trim();
    if (!inputPrompt) {
      throw new BadRequestException("Generation prompt is required");
    }

    const character = await this.generation.findCharacterForImageDraft(
      input.characterId,
    );
    if (!character) {
      throw new BadRequestException("Character not found");
    }

    // 자동(draft) 기획과 동일한 캐릭터 컨텍스트로 장면을 확장한다.
    // 운영자 원문은 sceneHint(반영 필수)로 전달된다.
    const planner = await this.resolveScenePlanner();
    const requestId = randomUUID();
    let scene = inputPrompt;
    let captureSetup =
      "No separate capture metadata was provided; follow the scene literally with a physically plausible viewpoint";
    let characterVisible = true;
    const availableReferences = (
      character.visualProfile?.referenceMedia ?? []
    ).filter((reference) => reference.media.uploadedAt);
    // 플래너가 없으면 구버전 위저드와 동일하게 사용 가능한 프로필
    // 레퍼런스를 모두 쓰되, _shot에 명시해 빌드 라우트와 실행 라우트를 맞춘다.
    let referenceMediaIds: string[] = availableReferences.map(
      (reference) => reference.mediaId,
    );
    if (planner) {
      // 캡션 있는 레퍼런스만 카탈로그로 — 장면과 함께 레퍼런스도 고른다.
      const referenceCatalog = availableReferences
        .filter((reference) => reference.description)
        .map((reference) => ({
          id: reference.mediaId,
          description: reference.description,
        }));
      let plan;
      try {
        plan = await planner.plan(
          {
            characterName: character.displayName,
            bio: character.bio,
            interests: character.interests,
            personas: character.personas,
            memories: character.memories.map((memory) => memory.content),
            recentCaptions: character.posts
              .map((post) => post.content)
              .filter(Boolean),
            sceneHint: inputPrompt,
            maxShots: 1,
            ...(referenceCatalog.length > 0 ? { referenceCatalog } : {}),
          },
          { requestId, characterId: input.characterId },
        );
      } catch (error) {
        throw new BadGatewayException(
          `Scene planning failed (${planner.name}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const plannedShot = plan.shots[0];
      scene = plannedShot?.scene ?? inputPrompt;
      captureSetup = plannedShot?.captureSetup ?? captureSetup;
      characterVisible = plannedShot?.characterVisible ?? characterVisible;
      referenceMediaIds = plannedShot?.referenceIds ?? [];
    }
    const uploadedReferenceIds = new Set(
      availableReferences.map((reference) => reference.mediaId),
    );
    referenceMediaIds = characterVisible
      ? referenceMediaIds.filter((id) => uploadedReferenceIds.has(id))
      : [];
    try {
      assertVisibleCharacterHasReference(
        characterVisible,
        referenceMediaIds.length,
        "shot 0",
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }

    // 장면을 이미지 모델용 프롬프트로 변환 — 자동 파이프라인과 같은 빌드 단계.
    // 운영자는 이어지는 프롬프트 확인 카드에서 결과를 검토·수정한다.
    const builder = await this.resolvePromptBuilder();
    const targetModelId = targetModelIdForShot(
      builder,
      referenceMediaIds.length > 0,
    );
    let prompt: string;
    try {
      prompt = (
        await builder.build(
          {
            appearancePrompt: character.visualProfile?.appearancePrompt ?? "",
            stylePrompt: character.visualProfile?.stylePrompt ?? "",
            shots: [
              {
                sortOrder: 0,
                scene,
                captureSetup,
                characterVisible,
                targetModelId,
              },
            ],
          },
          { requestId, characterId: input.characterId },
        )
      ).prompts[0];
    } catch (error) {
      throw new BadGatewayException(
        `Prompt build failed (${builder.name}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 밑줄 접두 키는 파이프라인 메타데이터 — 프로바이더 파라미터로
    // 전달되지 않는다 (generation-worker가 걸러낸다). aspect_ratio는
    // 프로바이더 파라미터로 그대로 전달되어 프로필 providerConfig
    // 기본값을 잡 단위로 덮어쓴다 (게시글 4:3 / 스토리 16:9 프리셋).
    const paramsJson: GenerationParamsObject = {
      ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
      ...(planner
        ? {
            _wizard: {
              plannerName: planner.name,
              builderName: builder.name,
              expandedScene: scene,
            },
          }
        : {}),
      _shot: {
        sortOrder: 0,
        scene,
        captureSetup,
        characterVisible,
        referenceMediaIds,
        ...(targetModelId ? { targetModelId } : {}),
      },
    };
    const job = await this.generation.createImageDraft({
      characterId: input.characterId,
      inputPrompt,
      prompt,
      candidateCount,
      paramsJson,
    });
    return this.toGenerationJob(
      job as PersistedGenerationJob,
      character.visualProfile,
    );
  }

  async updateImageDraft(
    jobId: string,
    input: { prompt: string; candidateCount: number },
  ): Promise<GenerationJob> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new BadRequestException("Generation prompt is required");
    }
    const candidateCount = this.parseCandidateCount(input.candidateCount);
    const transitioned = await this.generation.updateImageDraft(jobId, {
      prompt,
      candidateCount,
    });
    if (!transitioned) {
      await this.getJob(jobId);
      throw new BadRequestException("Only draft generation jobs can be edited");
    }
    return this.getJob(jobId);
  }

  async confirmImageDraft(jobId: string): Promise<GenerationJob> {
    const transitioned = await this.generation.confirmImageDraft(jobId);
    const job = await this.getJob(jobId);
    if (transitioned || job.status !== "draft") {
      return job;
    }
    throw new BadRequestException(
      "Only draft generation jobs can be confirmed",
    );
  }

  async selectOutput(jobId: string, mediaId: string): Promise<GenerationJob> {
    const selected = await this.generation.selectOutput(jobId, mediaId);
    if (selected === "missing") {
      throw new BadRequestException(
        "Generation output not found for completed job",
      );
    }
    return this.getJob(jobId);
  }

  async regenerateImageJob(jobId: string): Promise<GenerationJob> {
    const source = await this.generation.findJob(jobId);
    if (!source) {
      throw new BadRequestException("Generation job not found");
    }
    if (
      source.mediaType !== "image" ||
      (source.status !== "completed" && source.status !== "failed")
    ) {
      throw new BadRequestException(
        "Only completed or failed image jobs can be regenerated",
      );
    }

    const job = await this.generation.createRegeneratedImageJob(source);
    return this.toGenerationJob(job as PersistedGenerationJob);
  }

  async listJobs(
    input: {
      characterId?: string;
      status?: string;
      mediaType?: string;
      scope?: string;
    } & PageInput,
  ): Promise<Page<GenerationJob>> {
    const characterId = input.characterId?.trim();
    const status = this.parseOptionalStatus(input.status);
    const mediaType = this.parseOptionalMediaType(input.mediaType);
    const scope = input.scope?.trim();
    if (scope && scope !== "standalone") {
      throw new BadRequestException("Generation scope must be standalone");
    }
    const filter = {
      ...(characterId ? { characterId } : {}),
      ...(status ? { status } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(scope === "standalone" ? { draftId: null } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.generation.cursorMatchesFilter(cursorId, filter))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const jobs = await this.generation.findManyForList({
      ...filter,
      take: input.limit + 1,
      ...(cursorId ? { cursor: cursorId } : {}),
    });
    return pageFromRows(
      jobs.map((job) => this.toGenerationJob(job as PersistedGenerationJob)),
      input.limit,
    );
  }

  async enqueueJob(input: {
    characterId: string;
    mediaType: string;
    prompt: string;
    provider?: string;
    paramsJson?: GenerationParams;
    originJobId?: string;
  }): Promise<GenerationJob> {
    if (input.mediaType !== "image" && input.mediaType !== "video") {
      throw new BadRequestException(
        "Generation media type must be image or video",
      );
    }
    if (!input.prompt.trim()) {
      throw new BadRequestException("Generation prompt is required");
    }

    const mediaType = input.mediaType;
    const prompt = input.prompt.trim();

    const job = await this.generation.enqueueJob({
      characterId: input.characterId,
      mediaType,
      prompt,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.paramsJson !== undefined
        ? { paramsJson: input.paramsJson }
        : {}),
      ...(input.originJobId ? { originJobId: input.originJobId } : {}),
    });
    return this.toGenerationJob(job as PersistedGenerationJob);
  }

  async startJob(jobId: string): Promise<GenerationJob> {
    const transitioned = await this.generation.startJob(
      jobId,
      new Date(Date.now() + MANUAL_START_LEASE_MS),
    );
    if (!transitioned) {
      await this.getJob(jobId); // 404를 400보다 먼저 구분한다.
      throw new BadRequestException("Only queued generation jobs can start");
    }
    return this.getJob(jobId);
  }

  async retryJob(jobId: string, reason?: string): Promise<GenerationJob> {
    const source = await this.generation.findJob(jobId);
    if (!source) {
      throw new BadRequestException("Generation job not found");
    }
    if (source.status !== "failed") {
      throw new BadRequestException(
        "Only failed generation jobs can be retried",
      );
    }
    if (source.draftId) {
      throw new BadRequestException(
        "Draft generation jobs must be retried from draft review",
      );
    }
    const job = await this.generation.retryJob(
      source,
      reason?.trim() || "generation job retried",
    );
    return this.toGenerationJob(job as PersistedGenerationJob);
  }

  async failJob(input: {
    jobId: string;
    errorMessage: string;
  }): Promise<GenerationJob> {
    const transitioned = await this.generation.failJob(
      input.jobId,
      input.errorMessage,
    );
    if (!transitioned) {
      const job = await this.getJob(input.jobId);
      if (job.status === "failed") {
        return job;
      }
      throw new BadRequestException(
        "Only queued or running generation jobs can fail",
      );
    }
    return this.getJob(input.jobId);
  }

  async completeJob(input: {
    jobId: string;
    url?: string;
    mediaId?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }): Promise<GenerationJob> {
    if (input.mediaId) {
      return this.completeJobWithMediaId(input.jobId, input.mediaId);
    }
    if (!input.url?.trim()) {
      throw new BadRequestException("Generated media URL is required");
    }
    return this.completeJobWithUrl(input.jobId, {
      url: input.url.trim(),
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
    });
  }

  private async completeJobWithMediaId(
    jobId: string,
    mediaId: string,
  ): Promise<GenerationJob> {
    const job = await this.getJob(jobId);
    assertUploadedMediaRow(
      await this.generation.findUploadedMedia(mediaId),
      job.mediaType,
    );

    const transitioned = await this.generation.completeJobWithMediaId(
      jobId,
      mediaId,
    );
    if (!transitioned) {
      return this.assertIdempotentComplete(jobId);
    }
    return this.getJob(jobId);
  }

  private async completeJobWithUrl(
    jobId: string,
    outputMedia: {
      url: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
    },
  ): Promise<GenerationJob> {
    const job = await this.getJob(jobId);

    // Media 생성과 상태 전이를 한 트랜잭션으로 묶어, 전이 실패 시 고아 Media를 남기지 않는다.
    // 주의: uploadedAt이 없는 Media는 게시(createPost/createStory)에 쓸 수 없다.
    // 파이프라인(워커) 경로는 반드시 S3 재업로드 + uploadedAt 확정 경로를 쓴다.
    const completed = await this.generation.completeJobWithUrl({
      jobId,
      mediaType: job.mediaType,
      ...outputMedia,
    });
    if (!completed) {
      return this.assertIdempotentComplete(jobId);
    }
    return this.getJob(jobId);
  }

  // 전이에 실패했을 때: 이미 완료된 잡이면 그대로 반환(멱등), 아니면 400.
  private async assertIdempotentComplete(
    jobId: string,
  ): Promise<GenerationJob> {
    const job = await this.getJob(jobId);
    if (job.status === "completed") {
      return job;
    }
    throw new BadRequestException("Only running generation jobs can complete");
  }

  async getJob(jobId: string): Promise<GenerationJob> {
    const job = await this.generation.findJobDetail(jobId);

    if (!job) {
      throw new BadRequestException("Generation job not found");
    }

    return this.toGenerationJob(job as PersistedGenerationJob);
  }

  private parseOptionalStatus(status?: string): JobStatus | undefined {
    const value = status?.trim();
    if (!value) {
      return undefined;
    }
    if (
      value === "draft" ||
      value === "queued" ||
      value === "running" ||
      value === "completed" ||
      value === "failed"
    ) {
      return value;
    }
    throw new BadRequestException(
      "Generation job status must be draft, queued, running, completed, or failed",
    );
  }

  private parseCandidateCount(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 4) {
      throw new BadRequestException(
        "Candidate count must be an integer from 1 to 4",
      );
    }
    return value;
  }

  private parseOptionalMediaType(mediaType?: string): MediaType | undefined {
    const value = mediaType?.trim();
    if (!value) {
      return undefined;
    }
    if (value === "image" || value === "video") {
      return value;
    }
    throw new BadRequestException(
      "Generation media type must be image or video",
    );
  }

  private toGenerationJob(
    job: PersistedGenerationJob,
    imageProfile?: ImageProfile | null,
  ): GenerationJob {
    const outputMedia = job.outputMedia
      ? {
          mediaType: job.outputMedia.mediaType,
          url: job.outputMedia.url,
          width: job.outputMedia.width ?? undefined,
          height: job.outputMedia.height ?? undefined,
          durationSeconds: job.outputMedia.durationSeconds ?? undefined,
        }
      : undefined;
    const outputs = job.outputs?.map((output) => ({
      mediaId: output.mediaId,
      url: output.media.url,
      candidateIndex: output.candidateIndex,
      selected: output.selected,
    }));
    const profile =
      imageProfile !== undefined ? imageProfile : job.character?.visualProfile;
    const generationContext =
      imageProfile !== undefined || job.character !== undefined
        ? this.toGenerationContext(profile ?? null)
        : undefined;

    const wizard = wizardMetaFromParams(job.paramsJson);
    const aspectRatio = aspectRatioFromParams(job.paramsJson);
    const providerProgress =
      job.status === "running"
        ? providerProgressFromParams(job.paramsJson)
        : undefined;

    return {
      id: job.id,
      characterId: job.characterId,
      mediaType: job.mediaType,
      prompt: job.prompt,
      ...(job.inputPrompt ? { inputPrompt: job.inputPrompt } : {}),
      ...(wizard?.expandedScene ? { expandedScene: wizard.expandedScene } : {}),
      ...(wizard?.plannerName ? { plannerName: wizard.plannerName } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(job.candidateCount != null
        ? { candidateCount: job.candidateCount }
        : {}),
      status: job.status,
      ...(job.outputMediaId ? { outputMediaId: job.outputMediaId } : {}),
      attemptCount: job.attemptCount ?? 0,
      ...(job.provider ? { provider: job.provider } : {}),
      ...(providerProgress ? { providerProgress } : {}),
      ...(job.draftId ? { draftId: job.draftId } : {}),
      ...(job.originJobId ? { originJobId: job.originJobId } : {}),
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      ...(job.costUsd != null ? { costUsd: job.costUsd.toString() } : {}),
      ...(outputMedia ? { outputMedia } : {}),
      ...(outputs && outputs.length > 0 ? { outputs } : {}),
      ...(generationContext ? { generationContext } : {}),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private toGenerationContext(profile: ImageProfile | null): {
    negativePrompt: string;
    referenceImageCount: number;
    route: "t2i" | "edit";
  } {
    const referenceImageCount = (profile?.referenceMedia ?? []).filter(
      (reference) => reference.media.uploadedAt,
    ).length;
    return {
      negativePrompt: profile?.negativePrompt ?? "",
      referenceImageCount,
      route: referenceImageCount > 0 ? "edit" : "t2i",
    };
  }
}

function providerProgressFromParams(
  paramsJson: GenerationParamsValue | null | undefined,
): ImageGenerationProgress | undefined {
  if (
    paramsJson == null ||
    typeof paramsJson !== "object" ||
    Array.isArray(paramsJson)
  ) {
    return undefined;
  }
  const value = (paramsJson as Record<string, unknown>)._providerProgress;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const progress = value as Record<string, unknown>;
  const status = progress.status;
  if (status !== "queued" && status !== "running" && status !== "cancelling") {
    return undefined;
  }
  const phase = progress.phase;
  const validPhase =
    phase === "preparing" ||
    phase === "generating" ||
    phase === "quality_check" ||
    phase === "finalizing"
      ? phase
      : undefined;
  const amount =
    typeof progress.progress === "number" &&
    Number.isFinite(progress.progress) &&
    progress.progress >= 0 &&
    progress.progress <= 1
      ? progress.progress
      : undefined;
  return {
    status,
    ...(validPhase ? { phase: validPhase } : {}),
    ...(typeof progress.stage === "string" || progress.stage === null
      ? { stage: progress.stage }
      : {}),
    ...(amount !== undefined ? { progress: amount } : {}),
    ...(typeof progress.updatedAt === "string"
      ? { updatedAt: progress.updatedAt }
      : {}),
  };
}

// paramsJson.aspect_ratio — 잡 단위 종횡비 오버라이드를 꺼낸다.
function aspectRatioFromParams(
  paramsJson: GenerationParamsValue | null | undefined,
): string | undefined {
  if (
    paramsJson == null ||
    typeof paramsJson !== "object" ||
    Array.isArray(paramsJson)
  ) {
    return undefined;
  }
  const value = (paramsJson as Record<string, unknown>).aspect_ratio;
  return typeof value === "string" ? value : undefined;
}

// paramsJson._wizard — 위저드 장면 확장 메타데이터를 꺼낸다.
function wizardMetaFromParams(
  paramsJson: GenerationParamsValue | null | undefined,
): { plannerName?: string; expandedScene?: string } | null {
  if (
    paramsJson == null ||
    typeof paramsJson !== "object" ||
    Array.isArray(paramsJson)
  ) {
    return null;
  }
  const wizard = (paramsJson as Record<string, unknown>)._wizard;
  if (wizard == null || typeof wizard !== "object" || Array.isArray(wizard)) {
    return null;
  }
  const record = wizard as Record<string, unknown>;
  return {
    ...(typeof record.plannerName === "string"
      ? { plannerName: record.plannerName }
      : {}),
    ...(typeof record.expandedScene === "string"
      ? { expandedScene: record.expandedScene }
      : {}),
  };
}
