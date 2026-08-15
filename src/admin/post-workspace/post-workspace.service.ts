import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  generationSetHash,
  isPostPipelineV3,
  isPostPipelineV4,
} from "../../worker/post-pipeline-v3";
import {
  PostWorkspaceRepository,
  PostWorkDraft,
  StandalonePost,
} from "./post-workspace.repository";

export const POST_WORK_FILTERS = [
  "all",
  "needs_action",
  "agent",
  "publish_waiting",
  "published",
  "failed",
] as const;

export type PostWorkFilter = (typeof POST_WORK_FILTERS)[number];
export type PostWorkStage =
  | "brief"
  | "plan"
  | "post_plan"
  | "image_plan"
  | "prompt"
  | "evaluation"
  | "generation"
  | "review"
  | "caption"
  | "publish"
  | "memory";
export type OperationalStatus =
  "failed" | "needs_action" | "publish_waiting" | "agent_running" | "completed";

export type PostPipelineV3ReadModel = {
  // v4 = 검수 없음(⑥ 캡션 단계). 화면 레일이 이 값으로 갈린다.
  version: "post-pipeline-v3" | "post-pipeline-v4";
  stage:
    | "post_plan"
    | "image_plan"
    | "image_prompt"
    | "generation"
    | "review"
    | "caption"
    | "publish"
    | "memory";
  state: string;
  imageCount: number | null;
  reasonCodes: string[];
  nextAction: string;
  // 게시 시 실제로 읽는 후보 목록(concept 최상위). 산출물이 아니라 파이프라인이
  // 소유하는 상태라 artifacts 밖에 둔다.
  memoryCandidates?: V3MemoryCandidate[];
  artifacts: {
    postPlan?: {
      revision: number;
      status: string;
      contractVersion?: string;
      promptVersion?: string;
      hash?: string;
      premise?: string;
      primaryPurpose?: string;
      secondaryPurpose?: string;
      caption?: string;
      hashtags?: string[];
      captionLanguages?: string[];
      memoryCandidates?: { type: string; content: string }[];
      conflicts?: { left: string; right: string; reason: string }[];
      planningInput?: V3PlanningInput;
    };
    imagePlan?: {
      revision: number;
      status: string;
      contractVersion?: string;
      promptVersion?: string;
      hash?: string;
      shotCount?: number;
      locationId?: string;
      shots?: V3ImagePlanShot[];
      lockedElements?: {
        category: string;
        description: string;
        appliesToShots: number[];
      }[];
      blockedReasons?: { code: string; detail: string }[];
    };
    promptBuild?: {
      revision: number;
      shotCount: number;
      contractVersion?: string;
      promptVersion?: string;
      hash?: string;
      targetModelId?: string;
      policyVersion?: string;
      usesNegativePrompt?: boolean;
      shots?: {
        sortOrder: number;
        prompt: string;
        negativePrompt?: string;
        slots?: {
          slot: string;
          bindingId: string;
          referenceId: string;
          source: string;
        }[];
      }[];
    };
    // V4 ⑥ 캡션. stale·matchesColumn은 서버 계산이다 — 클라이언트가 두 쿼리를
    // 비교하면 폴링 간격만큼 어긋난 값이 깜빡인다.
    captionBuild?: {
      revision: number;
      contractVersion?: string;
      promptVersion?: string;
      hash?: string;
      caption: string;
      hashtags: string[];
      captionLanguages: string[];
      operatorNote?: string;
      // 컷 재생성으로 게시 이미지 집합이 바뀌었는가(작성 기준 ≠ 현재).
      stale: boolean;
      // 게시 컬럼이 Agent 원본과 같은가(false = 운영자 수정본).
      matchesColumn: boolean;
    };
  };
};

// 후보의 "저장됨" 여부는 draft 상태와 합쳐야 나오므로 여기서는 게시 로직
// (`selectedPublishedMemories`)이 실제로 거르는 두 조건만 내린다.
export type V3MemoryCandidate = {
  type: string;
  content: string;
  selected: boolean;
  stale: boolean;
};

// Context Assembler가 조립해 Agent에게 실제로 넘긴 입력. "왜 이런 캡션이
// 나왔는가"를 프롬프트를 의심하기 전에 확인하는 유일한 경로다.
export type V3PlanningInput = {
  persona: { group: string; title: string; content: string }[];
  memories: { type: string; content: string }[];
  recentPosts: { premise?: string; caption: string; hashtags: string[] }[];
};

export type V3ImagePlanShot = {
  sortOrder: number;
  visualPurpose?: string;
  scene?: string;
  captureSetup?: string;
  presentation?: {
    mode: string;
    visibleParts: string[];
    faceVisible: boolean;
    identityPreservationRequired: boolean;
  };
  referenceBindings?: {
    bindingId: string;
    referenceId: string;
    source: string;
    semanticPurposes: string[];
    preserve: string[];
    avoidCopying: string[];
  }[];
};

export type PostWorkItem = {
  id: string;
  kind: "draft" | "post";
  draftId?: string;
  postId?: string;
  characterId: string;
  contentType: string;
  caption: string;
  thumbnailUrl?: string;
  currentStage: PostWorkStage;
  stageIndex: number;
  operationalStatus: OperationalStatus;
  statusDetail: string;
  executionMode: "manual" | "auto";
  source: "manual" | "scheduler" | "direct" | "unknown";
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  pipelineV3?: PostPipelineV3ReadModel;
};

type WorkCursor = Pick<PostWorkItem, "id" | "kind" | "updatedAt">;

const STAGES: PostWorkStage[] = [
  "brief",
  "plan",
  "prompt",
  "evaluation",
  "generation",
  "review",
  "publish",
  "memory",
];

const V3_STAGES: PostWorkStage[] = [
  "brief",
  "post_plan",
  "image_plan",
  "prompt",
  "generation",
  "review",
  "publish",
  "memory",
];

// V4: 검수 대신 캡션. 같은 8칸이라 stageIndex 의미가 유지된다.
const V4_STAGES: PostWorkStage[] = [
  "brief",
  "post_plan",
  "image_plan",
  "prompt",
  "generation",
  "caption",
  "publish",
  "memory",
];

@Injectable()
export class PostWorkspaceService {
  constructor(private readonly repository: PostWorkspaceRepository) {}

  async list(input: {
    filter?: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: PostWorkItem[]; nextCursor?: string }> {
    const filter = parseFilter(input.filter);
    const cursor = parseCursor(input.cursor);
    const take = Math.min(input.limit * (filter === "all" ? 2 : 4) + 1, 401);
    const before = cursor ? new Date(cursor.updatedAt) : undefined;

    const [drafts, posts] = await Promise.all([
      this.repository.findDrafts({
        where: draftWhere(filter),
        ...(before ? { before } : {}),
        take,
      }),
      filter === "all" || filter === "published"
        ? this.repository.findStandalonePosts({
            onlyStandalone: true,
            ...(before ? { before } : {}),
            take,
          })
        : Promise.resolve([]),
    ]);

    const merged = [
      ...drafts.map(toDraftWorkItem),
      ...posts.map(toStandalonePostWorkItem),
    ]
      .filter((item) => matchesFilter(item, filter))
      .sort(compareWorkItems)
      .filter((item) => !cursor || compareWorkItems(item, cursor) > 0);

    const items = merged.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      ...(merged.length > input.limit && last
        ? { nextCursor: encodeCursor(last) }
        : {}),
    };
  }

  async get(id: string): Promise<PostWorkItem> {
    const draft = await this.repository.findDraft(id);
    if (draft) return toDraftWorkItem(draft);
    const post = await this.repository.findStandalonePost(id);
    if (post) return toStandalonePostWorkItem(post);
    throw new NotFoundException("Post work item not found");
  }
}

function parseFilter(value?: string): PostWorkFilter {
  const filter = value?.trim() || "all";
  if (!POST_WORK_FILTERS.includes(filter as PostWorkFilter)) {
    throw new BadRequestException(
      `Post work filter must be one of ${POST_WORK_FILTERS.join(", ")}`,
    );
  }
  return filter as PostWorkFilter;
}

function draftWhere(filter: PostWorkFilter): Prisma.PostDraftWhereInput {
  if (filter === "published") return { status: "published" };
  if (filter === "publish_waiting") return { status: "approved" };
  if (filter === "failed") return { status: "failed" };
  if (filter === "agent") {
    return { status: { in: ["planned", "generating", "regenerating"] } };
  }
  if (filter === "needs_action") {
    return {
      status: {
        in: ["planned", "generating", "needs_review", "regenerating"],
      },
    };
  }
  return {};
}

function matchesFilter(item: PostWorkItem, filter: PostWorkFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_action") {
    return item.operationalStatus === "needs_action";
  }
  if (filter === "agent") return item.operationalStatus === "agent_running";
  if (filter === "publish_waiting") {
    return item.operationalStatus === "publish_waiting";
  }
  if (filter === "published") return item.currentStage === "memory";
  return item.operationalStatus === "failed";
}

function toDraftWorkItem(draft: PostWorkDraft): PostWorkItem {
  const concept = record(draft.conceptJson);
  const mode = concept.mode === "manual" ? "manual" : "auto";
  const source = sourceOf(concept.source);
  const latestJobs = latestJobsPerShot(draft);
  const currentStage = stageForDraft(draft, latestJobs);
  const operational = statusForDraft(draft, latestJobs, currentStage, mode);
  const pipelineV3 = v3ReadModel(concept, draft, latestJobs);
  const publishedThumbnail =
    draft.publishedPost?.postMedia[0]?.media.url ?? undefined;
  const generatedThumbnail = latestJobs
    .flatMap((job) => job.outputs)
    .sort((left, right) => Number(right.selected) - Number(left.selected))[0]
    ?.media.url;

  return {
    id: draft.id,
    kind: "draft",
    draftId: draft.id,
    ...(draft.publishedPostId ? { postId: draft.publishedPostId } : {}),
    characterId: draft.characterId,
    contentType: draft.contentType,
    caption: draft.caption,
    ...(publishedThumbnail || generatedThumbnail
      ? { thumbnailUrl: publishedThumbnail ?? generatedThumbnail }
      : {}),
    currentStage,
    stageIndex:
      (pipelineV3
        ? pipelineV3.version === "post-pipeline-v4"
          ? V4_STAGES
          : V3_STAGES
        : STAGES
      ).indexOf(currentStage) + 1,
    operationalStatus: operational.status,
    statusDetail: operational.detail,
    executionMode: mode,
    source,
    ...(draft.scheduledAt
      ? { scheduledAt: draft.scheduledAt.toISOString() }
      : {}),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    ...(pipelineV3 ? { pipelineV3 } : {}),
  };
}

function toStandalonePostWorkItem(post: StandalonePost): PostWorkItem {
  return {
    id: post.id,
    kind: "post",
    postId: post.id,
    characterId: post.characterId,
    contentType: post.contentType,
    caption: post.content,
    ...(post.postMedia[0]?.media.url
      ? { thumbnailUrl: post.postMedia[0].media.url }
      : {}),
    currentStage: "memory",
    stageIndex: 8,
    operationalStatus: "completed",
    statusDetail: "게시 완료",
    executionMode: "manual",
    source: "direct",
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.createdAt.toISOString(),
  };
}

function latestJobsPerShot(draft: PostWorkDraft) {
  const jobs = new Map<number, PostWorkDraft["jobs"][number]>();
  for (const job of draft.jobs) {
    if (!jobs.has(job.sortOrder)) jobs.set(job.sortOrder, job);
  }
  return [...jobs.values()].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

function stageForDraft(
  draft: PostWorkDraft,
  jobs: PostWorkDraft["jobs"],
): PostWorkStage {
  if (draft.status === "published") return "memory";
  if (draft.status === "approved") return "publish";
  if (draft.status === "needs_review" || draft.status === "rejected") {
    return "review";
  }
  const concept = record(draft.conceptJson);
  if (isPostPipelineV3(concept)) {
    // V4 컷 재생성 중(regenerating)은 conceptJson stage가 caption/publish여도
    // 실제로는 ⑤가 다시 도는 중이다.
    if (draft.status === "regenerating") return "generation";
    const stage = record(concept.pipeline).stage;
    if (stage === "post_plan") return "post_plan";
    if (stage === "image_plan") return "image_plan";
    if (stage === "image_prompt") return "prompt";
    if (stage === "generation") return "generation";
    if (stage === "review") return "review";
    if (stage === "caption") return "caption";
    if (stage === "publish") return "publish";
    if (stage === "memory") return "memory";
    return "post_plan";
  }
  if (!record(concept.plan)) return "plan";
  if (jobs.length === 0) return "prompt";
  if (jobs.some((job) => job.status === "queued" || job.status === "running")) {
    return "generation";
  }
  if (
    jobs.some((job) => job.status === "completed" || job.status === "failed")
  ) {
    return jobs.every((job) => job.status === "completed")
      ? "review"
      : "generation";
  }
  return jobs.every((job) => job.prompt.trim().length > 0)
    ? "evaluation"
    : "prompt";
}

function statusForDraft(
  draft: PostWorkDraft,
  jobs: PostWorkDraft["jobs"],
  stage: PostWorkStage,
  mode: "manual" | "auto",
): { status: OperationalStatus; detail: string } {
  if (
    draft.status === "failed" ||
    (jobs.some((job) => job.status === "failed") &&
      !jobs.some((job) => job.status === "queued" || job.status === "running"))
  ) {
    return { status: "failed", detail: "실패 확인 필요" };
  }
  if (draft.status === "needs_review") {
    return { status: "needs_action", detail: "검수 필요" };
  }
  if (draft.status === "approved") {
    return { status: "publish_waiting", detail: "게시 대기" };
  }
  if (draft.status === "published") {
    return { status: "completed", detail: "게시 완료" };
  }
  if (draft.status === "rejected") {
    return { status: "completed", detail: "반려됨" };
  }
  const concept = record(draft.conceptJson);
  if (isPostPipelineV3(concept)) {
    const pipeline = record(concept.pipeline);
    const state =
      typeof pipeline.state === "string" ? pipeline.state : "pending";
    if (
      [
        "needs_input",
        "conflict",
        "blocked",
        "unsupported_plan",
        "needs_configuration",
      ].includes(state)
    ) {
      return { status: "needs_action", detail: v3StateCopy(state).detail };
    }
    if (state === "failed")
      return { status: "failed", detail: v3StateCopy(state).detail };
    if (state === "running" || (state === "pending" && mode === "auto")) {
      return { status: "agent_running", detail: "Agent 진행 중" };
    }
  }
  if (
    jobs.some((job) => job.status === "queued" || job.status === "running") ||
    mode === "auto"
  ) {
    return { status: "agent_running", detail: "Agent 진행 중" };
  }
  const detail: Record<PostWorkStage, string> = {
    brief: "브리프 작성 필요",
    plan: "기획 실행 필요",
    post_plan: "게시글 기획 실행 필요",
    image_plan: "이미지 기획 실행 필요",
    prompt: "프롬프트 생성 필요",
    evaluation: "평가 확인 후 생성",
    generation: "이미지 생성 필요",
    review: "검수 필요",
    caption: "캡션 생성 필요",
    publish: "게시 필요",
    memory: "완료",
  };
  return { status: "needs_action", detail: detail[stage] };
}

function v3ReadModel(
  concept: Record<string, unknown>,
  draft: Pick<PostWorkDraft, "caption">,
  latestJobs: PostWorkDraft["jobs"],
): PostPipelineV3ReadModel | undefined {
  if (!isPostPipelineV3(concept)) return undefined;
  const version = isPostPipelineV4(concept)
    ? ("post-pipeline-v4" as const)
    : ("post-pipeline-v3" as const);
  const pipeline = record(concept.pipeline);
  const rawStage = pipeline.stage;
  const stage =
    (
      [
        "post_plan",
        "image_plan",
        "image_prompt",
        "generation",
        "review",
        "caption",
        "publish",
        "memory",
      ] as const
    ).find((candidate) => candidate === rawStage) ?? "post_plan";
  const state = typeof pipeline.state === "string" ? pipeline.state : "pending";
  const imageCount = Number.isInteger(pipeline.imageCount)
    ? (pipeline.imageCount as number)
    : null;
  const reasonCodes = Array.isArray(pipeline.reasonCodes)
    ? pipeline.reasonCodes.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const postPlanning = record(concept.postPlanning);
  const postOutput = record(postPlanning.output);
  const postIntent = record(postOutput.intent);
  const imagePlanning = record(concept.imagePlanning);
  const imageOutput = record(imagePlanning.output);
  const promptBuild = record(concept.promptBuild);
  const promptOutput = record(promptBuild.output);
  const promptInput = record(promptBuild.input);
  const modelPolicy = record(promptInput.modelPolicy);
  const captionBuild = record(concept.captionBuild);
  const captionOutput = record(captionBuild.output);
  const captionInput = record(captionBuild.input);
  const captionSource = record(captionBuild.source);
  return {
    version,
    stage,
    state,
    imageCount,
    reasonCodes,
    nextAction: v3StateCopy(state).nextAction,
    ...(Array.isArray(concept.memoryCandidates)
      ? {
          memoryCandidates: v3MemoryCandidates(
            concept.memoryCandidates,
            postPlanning.hash,
          ),
        }
      : {}),
    artifacts: {
      ...(Number.isInteger(postPlanning.revision)
        ? {
            postPlan: {
              revision: postPlanning.revision as number,
              status:
                typeof postOutput.status === "string"
                  ? postOutput.status
                  : "unknown",
              ...lineage(postPlanning),
              ...(typeof postIntent.premise === "string"
                ? { premise: postIntent.premise }
                : {}),
              ...(typeof postIntent.primaryPurpose === "string"
                ? { primaryPurpose: postIntent.primaryPurpose }
                : {}),
              ...(typeof postIntent.secondaryPurpose === "string"
                ? { secondaryPurpose: postIntent.secondaryPurpose }
                : {}),
              ...(typeof postOutput.caption === "string"
                ? { caption: postOutput.caption }
                : {}),
              ...(Array.isArray(postOutput.hashtags)
                ? { hashtags: strings(postOutput.hashtags) }
                : {}),
              ...(Array.isArray(postOutput.captionLanguages)
                ? { captionLanguages: strings(postOutput.captionLanguages) }
                : {}),
              ...(Array.isArray(postOutput.newMemoryCandidates)
                ? {
                    memoryCandidates: postOutput.newMemoryCandidates.flatMap(
                      (candidate) => {
                        const item = record(candidate);
                        return typeof item.type === "string" &&
                          typeof item.content === "string"
                          ? [{ type: item.type, content: item.content }]
                          : [];
                      },
                    ),
                  }
                : {}),
              ...(record(postPlanning.input).persona ||
              record(postPlanning.input).memories
                ? { planningInput: v3PlanningInput(record(postPlanning.input)) }
                : {}),
              ...(Array.isArray(postOutput.conflicts)
                ? {
                    conflicts: postOutput.conflicts.flatMap((raw) => {
                      const item = record(raw);
                      const left = record(item.left);
                      const right = record(item.right);
                      return typeof item.reason === "string"
                        ? [
                            {
                              left: text(left.text),
                              right: text(right.text),
                              reason: item.reason,
                            },
                          ]
                        : [];
                    }),
                  }
                : {}),
            },
          }
        : {}),
      ...(Number.isInteger(imagePlanning.revision)
        ? {
            imagePlan: {
              revision: imagePlanning.revision as number,
              status:
                typeof imageOutput.status === "string"
                  ? imageOutput.status
                  : "unknown",
              ...lineage(imagePlanning),
              ...(Array.isArray(imageOutput.shots)
                ? {
                    shotCount: imageOutput.shots.length,
                    shots: imageOutput.shots.map(v3ImagePlanShot),
                  }
                : {}),
              ...(typeof imageOutput.locationId === "string"
                ? { locationId: imageOutput.locationId }
                : {}),
              ...(Array.isArray(record(imageOutput.continuity).lockedElements)
                ? {
                    lockedElements: (
                      record(imageOutput.continuity).lockedElements as unknown[]
                    ).map((raw) => {
                      const lock = record(raw);
                      return {
                        category: text(lock.category),
                        description: text(lock.description),
                        appliesToShots: Array.isArray(lock.appliesToShots)
                          ? lock.appliesToShots.filter(
                              (value): value is number =>
                                Number.isInteger(value),
                            )
                          : [],
                      };
                    }),
                  }
                : {}),
              ...(Array.isArray(imageOutput.reasons)
                ? {
                    blockedReasons: imageOutput.reasons.map((raw) => {
                      const reason = record(raw);
                      return {
                        code: text(reason.code),
                        detail: text(reason.detail),
                      };
                    }),
                  }
                : {}),
            },
          }
        : {}),
      ...(Number.isInteger(promptBuild.revision)
        ? {
            promptBuild: {
              revision: promptBuild.revision as number,
              shotCount: Array.isArray(promptOutput.shots)
                ? promptOutput.shots.length
                : 0,
              ...lineage(promptBuild),
              ...(typeof modelPolicy.modelId === "string"
                ? { targetModelId: modelPolicy.modelId }
                : {}),
              ...(typeof modelPolicy.version === "string"
                ? { policyVersion: modelPolicy.version }
                : {}),
              ...(typeof modelPolicy.usesNegativePrompt === "boolean"
                ? { usesNegativePrompt: modelPolicy.usesNegativePrompt }
                : {}),
              ...(Array.isArray(promptOutput.shots)
                ? {
                    shots: promptOutput.shots.map((raw) => {
                      const shot = record(raw);
                      const sortOrder = Number.isInteger(shot.sortOrder)
                        ? (shot.sortOrder as number)
                        : 0;
                      return {
                        sortOrder,
                        prompt: text(shot.prompt),
                        ...(typeof shot.negativePrompt === "string"
                          ? { negativePrompt: shot.negativePrompt }
                          : {}),
                        slots: promptSlots(promptInput, sortOrder),
                      };
                    }),
                  }
                : {}),
            },
          }
        : {}),
      ...(Number.isInteger(captionBuild.revision)
        ? {
            captionBuild: {
              revision: captionBuild.revision as number,
              ...lineage(captionBuild),
              caption: text(captionOutput.caption),
              hashtags: Array.isArray(captionOutput.hashtags)
                ? strings(captionOutput.hashtags)
                : [],
              captionLanguages: Array.isArray(captionOutput.captionLanguages)
                ? strings(captionOutput.captionLanguages)
                : [],
              ...(typeof captionInput.operatorNote === "string"
                ? { operatorNote: captionInput.operatorNote }
                : {}),
              // 작성 기준 이미지 집합 ≠ 현재 최신 완료 잡의 이미지 집합이면 stale.
              // 해시 함수는 캡션 단계·평가와 공유한다(post-pipeline-v3.ts).
              stale:
                typeof captionSource.generationSetHash === "string" &&
                captionSource.generationSetHash !==
                  generationSetHash(
                    latestJobs.map((job) => ({
                      sortOrder: job.sortOrder,
                      jobId: job.id,
                      mediaId: job.outputs.find((output) => output.selected)
                        ?.mediaId,
                    })),
                  ),
              matchesColumn: text(captionOutput.caption) === draft.caption,
            },
          }
        : {}),
    },
  };
}

// 산출물 계보. artifact에는 실행 시각이 없으므로 revision/hash/버전만 내린다.
// 어느 프롬프트 버전이 실제로 쓰였는지는 프롬프트 실험 관측의 1차 증거다.
// PromptSet은 같은 정보를 commonPromptVersion 키로 기록하므로 둘 다 읽는다.
function lineage(artifact: Record<string, unknown>) {
  const promptVersion =
    typeof artifact.promptVersion === "string"
      ? artifact.promptVersion
      : typeof artifact.commonPromptVersion === "string"
        ? artifact.commonPromptVersion
        : undefined;
  return {
    ...(typeof artifact.hash === "string" ? { hash: artifact.hash } : {}),
    ...(typeof artifact.contractVersion === "string"
      ? { contractVersion: artifact.contractVersion }
      : {}),
    ...(promptVersion ? { promptVersion } : {}),
  };
}

// 후보가 무효(stale)인지는 게시 로직과 같은 기준으로 판단한다 — 기획을 다시
// 돌리면 이전 후보는 남아 있어도 저장 대상이 아니다.
function v3MemoryCandidates(
  raw: unknown[],
  postPlanHash: unknown,
): V3MemoryCandidate[] {
  const currentHash = typeof postPlanHash === "string" ? postPlanHash : null;
  return raw.flatMap((value) => {
    const candidate = record(value);
    if (
      typeof candidate.type !== "string" ||
      typeof candidate.content !== "string"
    )
      return [];
    return [
      {
        type: candidate.type,
        content: candidate.content,
        selected: candidate.selected === true,
        stale:
          currentHash === null || candidate.sourcePostPlanHash !== currentHash,
      },
    ];
  });
}

function v3PlanningInput(input: Record<string, unknown>): V3PlanningInput {
  const persona = record(input.persona);
  const writingProfile = record(persona.writingProfile);
  const group = (name: string, value: unknown) =>
    (Array.isArray(value) ? value : []).flatMap((raw) => {
      const block = record(raw);
      return typeof block.content === "string" && block.content.trim()
        ? [{ group: name, title: text(block.title), content: block.content }]
        : [];
    });
  return {
    persona: [
      ...group("characterContext", persona.characterContext),
      ...group("contentStyle", writingProfile.contentStyle),
      ...group("voice", writingProfile.voice),
      ...group("boundaries", persona.boundaries),
      ...group("additionalContext", persona.additionalContext),
    ],
    memories: (Array.isArray(input.memories) ? input.memories : []).flatMap(
      (raw) => {
        const memory = record(raw);
        return typeof memory.content === "string"
          ? [{ type: text(memory.type), content: memory.content }]
          : [];
      },
    ),
    recentPosts: (Array.isArray(input.recentPosts)
      ? input.recentPosts
      : []
    ).flatMap((raw) => {
      const post = record(raw);
      return typeof post.caption === "string"
        ? [
            {
              ...(typeof post.premise === "string"
                ? { premise: post.premise }
                : {}),
              caption: post.caption,
              hashtags: Array.isArray(post.hashtags)
                ? strings(post.hashtags)
                : [],
            },
          ]
        : [];
    }),
  };
}

function v3ImagePlanShot(raw: unknown): V3ImagePlanShot {
  const shot = record(raw);
  const presentation = record(shot.characterPresentation);
  return {
    sortOrder: Number.isInteger(shot.sortOrder)
      ? (shot.sortOrder as number)
      : 0,
    ...(typeof shot.visualPurpose === "string"
      ? { visualPurpose: shot.visualPurpose }
      : {}),
    ...(typeof shot.scene === "string" ? { scene: shot.scene } : {}),
    ...(typeof shot.captureSetup === "string"
      ? { captureSetup: shot.captureSetup }
      : {}),
    ...(typeof presentation.mode === "string"
      ? {
          presentation: {
            mode: presentation.mode,
            visibleParts: Array.isArray(presentation.visibleParts)
              ? strings(presentation.visibleParts)
              : [],
            faceVisible: presentation.faceVisible === true,
            identityPreservationRequired:
              presentation.identityPreservationRequired === true,
          },
        }
      : {}),
    ...(Array.isArray(shot.referenceBindings)
      ? {
          referenceBindings: shot.referenceBindings.map((value) => {
            const binding = record(value);
            return {
              bindingId: text(binding.bindingId),
              referenceId: text(binding.id),
              source: text(binding.source),
              semanticPurposes: Array.isArray(binding.semanticPurposes)
                ? strings(binding.semanticPurposes)
                : [],
              preserve: Array.isArray(binding.preserve)
                ? strings(binding.preserve)
                : [],
              avoidCopying: Array.isArray(binding.avoidCopying)
                ? strings(binding.avoidCopying)
                : [],
            };
          }),
        }
      : {}),
  };
}

// 컷별 슬롯 바인딩. provider 직전 검증이 보는 것과 같은 매핑이라 어긋남을
// 실행 전에 눈으로 잡을 수 있다.
function promptSlots(promptInput: Record<string, unknown>, sortOrder: number) {
  const slots = Array.isArray(promptInput.referenceSlots)
    ? promptInput.referenceSlots
    : [];
  return slots.flatMap((value) => {
    const slot = record(value);
    if (slot.shotSortOrder !== sortOrder) return [];
    return [
      {
        slot: text(slot.slot),
        bindingId: text(slot.bindingId),
        referenceId: text(slot.referenceId),
        source: text(slot.source),
      },
    ];
  });
}

function strings(value: unknown[]): string[] {
  return value.filter((item): item is string => typeof item === "string");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function v3StateCopy(state: string): { detail: string; nextAction: string } {
  const copy: Record<string, { detail: string; nextAction: string }> = {
    pending: {
      detail: "다음 Agent 실행 대기",
      nextAction: "현재 단계를 실행하세요.",
    },
    running: {
      detail: "Agent 진행 중",
      nextAction: "완료될 때까지 기다리세요.",
    },
    ready: { detail: "단계 완료", nextAction: "다음 단계를 진행하세요." },
    needs_input: {
      detail: "필수 입력이 부족합니다",
      nextAction: "캐릭터 정보나 운영자 요청을 보완한 뒤 다시 실행하세요.",
    },
    conflict: {
      detail: "요청과 확정 정보가 충돌합니다",
      nextAction: "운영자 요청을 수정하거나 이 작업을 중단하세요.",
    },
    blocked: {
      detail: "현재 기획으로 진행할 수 없습니다",
      nextAction: "레퍼런스나 이미지 기획을 보완하세요.",
    },
    unsupported_plan: {
      detail: "현재 모델이 이 기획을 지원하지 않습니다",
      nextAction: "이미지 모델 또는 기획을 변경하세요.",
    },
    needs_configuration: {
      detail: "Agent 설정이 필요합니다",
      nextAction: "설정의 연결 테스트를 통과한 뒤 다시 실행하세요.",
    },
    failed: {
      detail: "Agent 실행이 실패했습니다",
      nextAction: "오류를 확인한 뒤 현재 단계를 재실행하세요.",
    },
  };
  return copy[state] ?? copy.pending;
}

function sourceOf(value: unknown): PostWorkItem["source"] {
  if (value === "manual") return "manual";
  if (value === "scheduler") return "scheduler";
  return "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compareWorkItems(
  left: Pick<PostWorkItem, "updatedAt" | "kind" | "id">,
  right: Pick<PostWorkItem, "updatedAt" | "kind" | "id">,
) {
  const time = right.updatedAt.localeCompare(left.updatedAt);
  if (time !== 0) return time;
  const kind = right.kind.localeCompare(left.kind);
  return kind !== 0 ? kind : right.id.localeCompare(left.id);
}

function encodeCursor(item: WorkCursor): string {
  return Buffer.from(JSON.stringify(item), "utf8").toString("base64url");
}

function parseCursor(value?: string): WorkCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<WorkCursor>;
    if (
      typeof parsed.id !== "string" ||
      (parsed.kind !== "draft" && parsed.kind !== "post") ||
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(new Date(parsed.updatedAt).getTime())
    ) {
      throw new Error("invalid cursor shape");
    }
    return { id: parsed.id, kind: parsed.kind, updatedAt: parsed.updatedAt };
  } catch {
    throw new BadRequestException("Invalid post work cursor");
  }
}
