import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type PostContentType = "feed" | "reel" | "story";

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

export type PostWorkFilter =
  "all" | "needs_action" | "agent" | "publish_waiting" | "published" | "failed";

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
  operationalStatus:
    | "failed"
    | "needs_action"
    | "publish_waiting"
    | "agent_running"
    | "completed";
  statusDetail: string;
  executionMode: "manual" | "auto";
  source: "manual" | "scheduler" | "direct" | "unknown";
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  pipelineV3?: {
    // v4 = 검수 없음(⑥ 캡션 단계). 레일이 이 값으로 갈린다.
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
    failure?: PipelineFailure;
    memoryCandidates?: V3MemoryCandidate[];
    artifacts: {
      postPlan?: V3Lineage & {
        status: string;
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
      imagePlan?: V3Lineage & {
        status: string;
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
      promptBuild?: V3Lineage & {
        shotCount: number;
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
      // V4 ⑥ 캡션 — stale·matchesColumn은 서버 계산.
      captionBuild?: V3Lineage & {
        caption: string;
        hashtags: string[];
        captionLanguages: string[];
        operatorNote?: string;
        stale: boolean;
        matchesColumn: boolean;
      };
    };
  };
};

export type PipelineFailure = {
  code: string;
  stage: string;
  problem: string;
  cause: string;
  nextAction: string;
  technicalDetail: string;
  occurredAt: string;
  retryable: boolean;
};

export type V3Lineage = {
  revision: number;
  contractVersion?: string;
  // 이 산출물을 만든 Agent 프롬프트 버전 (예: image-planner-v3).
  promptVersion?: string;
  hash?: string;
};

// 게시 시 실제로 저장되는 후보. "저장됨"은 draft 상태와 합쳐야 나오므로
// 서버는 게시 로직이 거르는 두 조건만 내린다.
export type V3MemoryCandidate = {
  key: string;
  type: string;
  content: string;
  selected: boolean;
  stale: boolean;
};

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
  subjectState?: string;
  motionEvidence?: string;
  notInFrame?: string[];
  subjectCameraRelation?: string;
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

export type PostListItem = {
  id: string;
  characterId: string;
  contentType: PostContentType;
  content: string;
  media: PostMedia[];
  hashtags: string[];
  commentCount: number;
  reactionCount: number;
  createdAt: string;
};

export type PostMedia = {
  mediaType: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type PostComment = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  body: string;
  createdAt: string;
};

export type PostReaction = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  reactionType: string;
  createdAt: string;
};

export type CharacterActionLog = {
  id: string;
  characterId: string;
  actionType: string;
  targetTable?: string;
  targetId?: string;
  reason: string;
  createdAt: string;
};

export type PostCreate = {
  actorType: "character";
  actorId: string;
  contentType: Exclude<PostContentType, "story">;
  content: string;
  reason: string;
  hashtags: string[];
  media: Array<{ mediaId: string }>;
};

export type PostCommentCreate = {
  characterId: string;
  body: string;
  reason?: string;
};

export type PostReactionCreate = {
  characterId: string;
  reactionType: string;
  reason?: string;
};

// 목록에서는 미디어를 종류와 장수로만 요약한다 — 썸네일은 상세에서 본다.
export function mediaLabel(media: PostMedia[] | undefined): string {
  const items = media ?? [];
  if (items.length === 0) return "없음";
  const type = items[0]?.mediaType ?? "media";
  return items.length > 1 ? `${type} ×${items.length}` : type;
}

export function fetchPosts(params: {
  characterId?: string;
  contentType?: string;
  cursor?: string;
}): Promise<CursorPage<PostListItem>> {
  return apiRequest(`/posts${toQuery(params)}`);
}

export function fetchPostWorkItems(params: {
  filter?: PostWorkFilter;
  cursor?: string;
}): Promise<CursorPage<PostWorkItem>> {
  return apiRequest(`/post-work-items${toQuery(params)}`);
}

export function fetchPostWorkItem(id: string): Promise<PostWorkItem> {
  return apiRequest(`/post-work-items/${encodeURIComponent(id)}`);
}

export function fetchPost(postId: string): Promise<PostListItem> {
  return apiRequest(postPath(postId));
}

export function fetchPostComments(
  postId: string,
  params: { cursor?: string; limit?: string } = {},
): Promise<CursorPage<PostComment>> {
  return apiRequest(`${postPath(postId)}/comments${toQuery(params)}`);
}

export function fetchPostReactions(
  postId: string,
  params: { cursor?: string; limit?: string } = {},
): Promise<CursorPage<PostReaction>> {
  return apiRequest(`${postPath(postId)}/reactions${toQuery(params)}`);
}

export function fetchPostActionLogs(
  postId: string,
): Promise<CursorPage<CharacterActionLog>> {
  return apiRequest<CursorPage<CharacterActionLog>>(
    "/character-action-logs",
  ).then((page) => ({
    ...page,
    items: page.items.filter((log) => log.targetId === postId),
  }));
}

export function createPost(body: PostCreate): Promise<PostListItem> {
  return apiRequest("/posts", { method: "POST", body });
}

export function createPostComment(
  postId: string,
  body: PostCommentCreate,
): Promise<{ id: string }> {
  return apiRequest(`${postPath(postId)}/comments`, {
    method: "POST",
    body,
  });
}

export function createPostReaction(
  postId: string,
  body: PostReactionCreate,
): Promise<{ id: string }> {
  return apiRequest(`${postPath(postId)}/reactions`, {
    method: "POST",
    body,
  });
}

function postPath(postId: string) {
  return `/posts/${encodeURIComponent(postId)}`;
}
