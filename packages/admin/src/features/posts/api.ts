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
    version: "post-pipeline-v3";
    stage:
      | "post_plan"
      | "image_plan"
      | "image_prompt"
      | "generation"
      | "review"
      | "publish"
      | "memory";
    state: string;
    imageCount: number | null;
    reasonCodes: string[];
    nextAction: string;
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
    };
  };
};

export type V3Lineage = {
  revision: number;
  contractVersion?: string;
  hash?: string;
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
