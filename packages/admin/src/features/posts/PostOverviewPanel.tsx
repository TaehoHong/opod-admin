import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  OperationMetric,
  OperationMetrics,
} from "../../shared/ui/OperationMetrics";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import type { Draft } from "../drafts/api";
import {
  fetchPostActionLogs,
  fetchPostComments,
  fetchPostReactions,
  fetchPostWorkMetrics,
  type PostListItem,
  type PostMedia,
  type PostWorkItem,
} from "./api";
import classes from "./PostOverviewPanel.module.css";

const LEGACY_STAGE_COUNT = 7;
const AGENT_STAGE_COUNT = 8;

export function PostOverviewPanel({
  item,
  draft,
  post,
  postError,
  retryPost,
}: {
  item: PostWorkItem;
  draft?: Draft;
  post?: PostListItem;
  postError?: Error | null;
  retryPost: () => void;
}) {
  const metrics = useQuery({
    queryKey: ["post-work-items", item.id, "metrics"],
    queryFn: () => fetchPostWorkMetrics(item.id),
  });
  const comments = useQuery({
    queryKey: ["posts", item.postId, "comments", "overview"],
    queryFn: () => fetchPostComments(item.postId!, { limit: "5" }),
    enabled: Boolean(item.postId),
  });
  const reactions = useQuery({
    queryKey: ["posts", item.postId, "reactions", "overview"],
    queryFn: () => fetchPostReactions(item.postId!, { limit: "5" }),
    enabled: Boolean(item.postId),
  });
  const activity = useQuery({
    queryKey: ["posts", item.postId, "activity", "overview"],
    queryFn: () => fetchPostActionLogs(item.postId!),
    enabled: Boolean(item.postId),
  });

  const interactionCount = metrics.data
    ? metrics.data.commentCount + metrics.data.reactionCount
    : null;
  const totalStages = item.pipelineV3 ? AGENT_STAGE_COUNT : LEGACY_STAGE_COUNT;
  const firstError =
    metrics.error ?? comments.error ?? reactions.error ?? activity.error;

  return (
    <Stack gap="lg">
      {firstError ? (
        <Alert color="red" title="일부 운영 정보를 불러오지 못했습니다">
          {firstError.message}
        </Alert>
      ) : null}
      {postError ? (
        <Alert color="red" title="게시 결과를 불러오지 못했습니다">
          <Group justify="space-between" align="center">
            <Text size="sm">{postError.message}</Text>
            <Button variant="default" size="compact-sm" onClick={retryPost}>
              다시 불러오기
            </Button>
          </Group>
        </Alert>
      ) : null}

      <OperationMetrics>
        <OperationMetric
          label="현재 진행"
          value={`${Math.min(item.stageIndex, totalStages)}/${totalStages}`}
          note={item.statusDetail}
        />
        <OperationMetric
          label={metrics.data?.publishedAt ? "제작 소요" : "제작 경과"}
          value={
            metrics.isPending ? (
              <Loader size="sm" aria-label="제작 시간 불러오는 중" />
            ) : metrics.data ? (
              durationLabel(
                metrics.data.productionStartedAt,
                metrics.data.publishedAt ?? new Date().toISOString(),
              )
            ) : (
              "—"
            )
          }
          note={metrics.data?.publishedAt ? "시작부터 게시까지" : "현재까지"}
        />
        <OperationMetric
          label="생성 안정성"
          value={
            metrics.data
              ? metrics.data.failedGenerationJobCount
                ? `${metrics.data.failedGenerationJobCount}건 실패`
                : "정상"
              : "—"
          }
          note={
            metrics.data
              ? `${metrics.data.generationJobCount}개 작업 · ${metrics.data.generationAttemptCount}회 시도`
              : "이미지 생성 작업"
          }
        />
        <OperationMetric
          label="공개 반응"
          value={interactionCount?.toLocaleString() ?? "—"}
          note={
            metrics.data
              ? `댓글 ${metrics.data.commentCount.toLocaleString()} · 반응 ${metrics.data.reactionCount.toLocaleString()}`
              : "게시 후 집계"
          }
        />
      </OperationMetrics>

      <div className={classes.layout}>
        <Stack gap="lg">
          <ContentSnapshot item={item} draft={draft} post={post} />
          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Stack gap={3}>
                  <Title order={3} fz="lg">
                    다음 행동
                  </Title>
                  <Text size="sm" c="dimmed">
                    현재 필요한 작업만 단계 화면에서 처리합니다.
                  </Text>
                </Stack>
                <Badge color={statusColor(item.operationalStatus)}>
                  {item.statusDetail}
                </Badge>
              </Group>
              <Text className={classes.nextAction}>
                {item.pipelineV3?.nextAction ?? fallbackNextAction(item)}
              </Text>
              <Group>
                <Button
                  component={Link}
                  to={`/posts/${encodeURIComponent(item.id)}/${item.currentStage}`}
                >
                  현재 단계 열기
                </Button>
                {item.currentStage !== "publish" ? (
                  <Button
                    component={Link}
                    to={`/posts/${encodeURIComponent(item.id)}/publish`}
                    variant="default"
                  >
                    게시본 확인
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </Paper>
        </Stack>

        <Stack gap="lg">
          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <Title order={3} fz="lg">
                운영 정보
              </Title>
              <dl className={classes.definitionList}>
                <Detail label="진행 방식" value={modeLabel(item)} />
                <Detail
                  label="제작 시작"
                  value={formatDateTime(
                    metrics.data?.productionStartedAt ?? item.createdAt,
                  )}
                />
                <Detail
                  label="최근 변경"
                  value={formatDateTime(
                    metrics.data?.lastChangedAt ?? item.updatedAt,
                  )}
                />
                <Detail
                  label="게시 시각"
                  value={
                    metrics.data?.publishedAt
                      ? formatDateTime(metrics.data.publishedAt)
                      : "미게시"
                  }
                />
                <Detail
                  label="게시 일정"
                  value={
                    item.scheduledAt
                      ? formatDateTime(item.scheduledAt)
                      : "승인 후 즉시"
                  }
                />
                <Detail
                  label="초안 시도"
                  value={`${metrics.data?.draftAttemptCount ?? draft?.attemptCount ?? 0}회`}
                />
              </dl>
            </Stack>
          </Paper>

          <InteractionSummary
            published={Boolean(item.postId)}
            comments={comments.data?.items ?? []}
            reactions={reactions.data?.items ?? []}
            pending={comments.isPending || reactions.isPending}
          />

          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <Title order={3} fz="lg">
                최근 활동
              </Title>
              {!item.postId ? (
                <Text size="sm" c="dimmed">
                  게시 후 운영 활동이 기록됩니다.
                </Text>
              ) : activity.isPending ? (
                <Loader size="sm" aria-label="게시물 활동 불러오는 중" />
              ) : activity.data?.items.length ? (
                <ul className={classes.list}>
                  {activity.data.items.slice(0, 5).map((log) => (
                    <li key={log.id} className={classes.listItem}>
                      <Stack gap={2} miw={0}>
                        <Badge variant="light" color="ink" w="fit-content">
                          {log.actionType}
                        </Badge>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {log.reason || "사유 없음"}
                        </Text>
                      </Stack>
                      <time className={classes.time} dateTime={log.createdAt}>
                        {formatDateTime(log.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text size="sm" c="dimmed">
                  기록된 활동이 없습니다.
                </Text>
              )}
            </Stack>
          </Paper>
        </Stack>
      </div>
    </Stack>
  );
}

function ContentSnapshot({
  item,
  draft,
  post,
}: {
  item: PostWorkItem;
  draft?: Draft;
  post?: PostListItem;
}) {
  const caption = post?.content || draft?.caption || item.caption;
  const hashtags = post?.hashtags ?? draft?.hashtags ?? [];
  const media = post?.media ?? selectedDraftMedia(draft);

  return (
    <Paper className={classes.panel} p="lg" component="section">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={3} fz="lg">
            콘텐츠
          </Title>
          <Badge variant="light" color={post ? "teal" : "ink"}>
            {post ? "게시본" : "작업 중"}
          </Badge>
        </Group>
        {media.length ? (
          <div className={classes.mediaGrid}>
            {media.map((entry, index) => (
              <MediaPreview
                key={`${entry.url}:${index}`}
                media={entry}
                index={index}
              />
            ))}
          </div>
        ) : item.thumbnailUrl ? (
          <ZoomableImage
            src={item.thumbnailUrl}
            alt="게시물 대표 이미지"
            className={classes.media}
            fit="contain"
          />
        ) : (
          <Alert color="gray">아직 확인할 수 있는 미디어가 없습니다.</Alert>
        )}
        <Text className={classes.caption}>
          {caption ||
            item.pipelineV3?.artifacts.postPlan?.premise ||
            "작성된 내용이 없습니다."}
        </Text>
        {hashtags.length ? (
          <Group gap="xs">
            {hashtags.map((tag) => (
              <Badge key={tag} variant="light">
                #{tag}
              </Badge>
            ))}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}

function MediaPreview({ media, index }: { media: PostMedia; index: number }) {
  return media.mediaType === "video" ? (
    <video
      className={classes.media}
      src={media.url}
      controls
      preload="metadata"
    >
      <track kind="captions" />
    </video>
  ) : (
    <ZoomableImage
      src={media.url}
      alt={`게시물 미디어 ${index + 1}`}
      className={classes.media}
      fit="contain"
    />
  );
}

function InteractionSummary({
  published,
  comments,
  reactions,
  pending,
}: {
  published: boolean;
  comments: Array<{ id: string; body: string; createdAt: string }>;
  reactions: Array<{ id: string; reactionType: string; createdAt: string }>;
  pending: boolean;
}) {
  return (
    <Paper className={classes.panel} p="lg" component="section">
      <Stack gap="md">
        <Title order={3} fz="lg">
          공개 반응
        </Title>
        {!published ? (
          <Text size="sm" c="dimmed">
            게시 후 댓글과 반응을 확인할 수 있습니다.
          </Text>
        ) : pending ? (
          <Loader size="sm" aria-label="공개 반응 불러오는 중" />
        ) : comments.length || reactions.length ? (
          <ul className={classes.list}>
            {comments.map((comment) => (
              <li key={comment.id} className={classes.compactItem}>
                <Badge size="xs" variant="light" color="ink">
                  댓글
                </Badge>
                <Text size="sm" lineClamp={2}>
                  {comment.body}
                </Text>
              </li>
            ))}
            {reactions.map((reaction) => (
              <li key={reaction.id} className={classes.compactItem}>
                <Badge size="xs" variant="light" color="teal">
                  반응
                </Badge>
                <Text size="sm">{reaction.reactionType}</Text>
              </li>
            ))}
          </ul>
        ) : (
          <Text size="sm" c="dimmed">
            아직 댓글이나 반응이 없습니다.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.detail}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function selectedDraftMedia(draft?: Draft): PostMedia[] {
  return (draft?.shots ?? []).flatMap((shot) =>
    shot.outputs
      .filter((output) => output.selected)
      .map((output) => ({ mediaType: "image" as const, url: output.url })),
  );
}

function modeLabel(item: PostWorkItem) {
  const source = {
    manual: "직접 생성",
    scheduler: "자동화 생성",
    direct: "직접 게시",
    unknown: "출처 미상",
  }[item.source];
  return `${source} · ${item.executionMode === "auto" ? "자동 진행" : "수동 진행"}`;
}

function fallbackNextAction(item: PostWorkItem) {
  if (item.operationalStatus === "completed")
    return "게시와 후속 처리가 완료되었습니다.";
  if (item.operationalStatus === "agent_running")
    return "Agent 작업이 끝날 때까지 기다려 주세요.";
  if (item.operationalStatus === "failed")
    return "실패 원인을 확인하고 현재 단계를 다시 실행하세요.";
  return "현재 단계의 내용을 확인하고 다음 작업을 진행하세요.";
}

function statusColor(status: PostWorkItem["operationalStatus"]) {
  if (status === "completed") return "teal";
  if (status === "failed") return "red";
  if (status === "agent_running") return "blue";
  return "attention";
}

function durationLabel(startValue: string, endValue: string) {
  const milliseconds = Math.max(
    0,
    Date.parse(endValue) - Date.parse(startValue),
  );
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24)
    return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`;
  const days = Math.floor(hours / 24);
  return `${days}일 ${hours % 24}시간`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
