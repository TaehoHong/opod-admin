import {
  Alert,
  Avatar,
  Badge,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { previewUrl } from "../../shared/media/previewUrl";
import {
  OperationMetric,
  OperationMetrics,
} from "../../shared/ui/OperationMetrics";
import { fetchPosts } from "../posts/api";
import {
  fetchCharacterActionLogs,
  fetchCharacterMetrics,
  fetchCharacterProfileImage,
  fetchPostingPolicy,
  fetchVisualProfile,
  type CharacterDetail,
} from "./api";
import classes from "./CharacterOverviewPanel.module.css";

export function CharacterOverviewPanel({
  character,
}: {
  character: CharacterDetail;
}) {
  const metrics = useQuery({
    queryKey: ["character", character.id, "metrics"],
    queryFn: () => fetchCharacterMetrics(character.id),
  });
  const profileImage = useQuery({
    queryKey: ["character", character.id, "profile-image"],
    queryFn: () => fetchCharacterProfileImage(character.id),
  });
  const policy = useQuery({
    queryKey: ["character", character.id, "posting-policy"],
    queryFn: () => fetchPostingPolicy(character.id),
  });
  const visual = useQuery({
    queryKey: ["character", character.id, "visual-profile"],
    queryFn: () => fetchVisualProfile(character.id),
  });
  const posts = useQuery({
    queryKey: ["posts", "character", character.id, "overview"],
    queryFn: () => fetchPosts({ characterId: character.id }),
  });
  const activity = useQuery({
    queryKey: ["character-action-logs", character.id, "overview"],
    queryFn: () =>
      fetchCharacterActionLogs({ characterId: character.id, limit: "5" }),
  });

  const firstError =
    metrics.error ??
    profileImage.error ??
    policy.error ??
    visual.error ??
    posts.error ??
    activity.error;
  const interactions = metrics.data
    ? metrics.data.commentsLast30Days + metrics.data.reactionsLast30Days
    : 0;
  const average = metrics.data?.postsLast30Days
    ? interactions / metrics.data.postsLast30Days
    : null;

  return (
    <Stack gap="lg">
      {firstError ? (
        <Alert
          color="red"
          role="alert"
          title="일부 운영 정보를 불러오지 못했습니다"
        >
          {firstError.message}
        </Alert>
      ) : null}

      <OperationMetrics>
        <OperationMetric
          label="최근 게시"
          value={
            metrics.isPending ? (
              <Loader size="sm" aria-label="최근 게시 불러오는 중" />
            ) : metrics.data?.lastPostAt ? (
              formatCompactDate(metrics.data.lastPostAt)
            ) : (
              "없음"
            )
          }
          note="가장 최근 공개된 게시물"
        />
        <OperationMetric
          label="최근 7일"
          value={metrics.data?.postsLast7Days.toLocaleString() ?? "—"}
          note="게시물"
        />
        <OperationMetric
          label="최근 30일 반응"
          value={metrics.data ? interactions.toLocaleString() : "—"}
          note={
            metrics.data
              ? `댓글 ${metrics.data.commentsLast30Days.toLocaleString()} · 반응 ${metrics.data.reactionsLast30Days.toLocaleString()}`
              : "댓글 + 반응"
          }
        />
        <OperationMetric
          label="게시물당 평균"
          value={average === null ? "—" : average.toFixed(1)}
          note="최근 30일 댓글·반응"
        />
      </OperationMetrics>

      <div className={classes.layout}>
        <Stack gap="lg">
          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <SectionHeader title="캐릭터 정보" section="profile" />
              <Group align="flex-start" wrap="nowrap">
                <Avatar
                  src={
                    profileImage.data?.image
                      ? previewUrl(profileImage.data.image.url)
                      : null
                  }
                  alt={`${character.displayName} 프로필 이미지`}
                  size={88}
                  radius="lg"
                >
                  {character.displayName.slice(0, 1)}
                </Avatar>
                <Stack gap={5} miw={0}>
                  <Group gap="xs">
                    <Text fw={750}>{character.displayName}</Text>
                    <Badge
                      color={character.status === "active" ? "teal" : "gray"}
                    >
                      {character.status === "active" ? "운영 중" : "비활성"}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    @{character.publicId}
                  </Text>
                  <Text size="sm">{character.bio}</Text>
                  {character.interests.length ? (
                    <Group gap={6}>
                      {character.interests.map((interest) => (
                        <Badge key={interest} variant="outline" color="ink">
                          {interest}
                        </Badge>
                      ))}
                    </Group>
                  ) : null}
                </Stack>
              </Group>
            </Stack>
          </Paper>

          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <SectionHeader title="최근 게시물" section="posts" />
              {posts.isPending ? (
                <Loader size="sm" aria-label="최근 게시물 불러오는 중" />
              ) : posts.data?.items.length ? (
                <ul className={classes.list}>
                  {posts.data.items.slice(0, 5).map((post) => (
                    <li className={classes.listItem} key={post.id}>
                      <Stack gap={3} miw={0}>
                        <Text size="sm" fw={650} lineClamp={1}>
                          {post.content || "(내용 없음)"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          댓글 {post.commentCount.toLocaleString()} · 반응{" "}
                          {post.reactionCount.toLocaleString()}
                        </Text>
                      </Stack>
                      <time className={classes.time} dateTime={post.createdAt}>
                        {formatDate(post.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text size="sm" c="dimmed">
                  공개된 게시물이 없습니다.
                </Text>
              )}
            </Stack>
          </Paper>
        </Stack>

        <Stack gap="lg">
          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <SectionHeader title="자동화" section="automation" />
              {policy.isPending ? (
                <Loader size="sm" aria-label="자동화 상태 불러오는 중" />
              ) : policy.data ? (
                <>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      포스팅 정책
                    </Text>
                    <Badge color={policy.data.enabled ? "teal" : "gray"}>
                      {policy.data.enabled ? "활성" : "비활성"}
                    </Badge>
                  </Group>
                  <div className={classes.summaryGrid}>
                    <Summary
                      label="주간 횟수"
                      value={`${policy.data.weeklyCadence}회`}
                    />
                    <Summary
                      label="운영 시간"
                      value={`${policy.data.hourStartKst}:00–${policy.data.hourEndKst}:00`}
                    />
                  </div>
                  <Text size="xs" c="dimmed">
                    최근 실행 · {runLabel(policy.data.lastRun)}
                  </Text>
                </>
              ) : null}
            </Stack>
          </Paper>

          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <SectionHeader title="설정 준비도" section="visual" />
              <div className={classes.summaryGrid}>
                <Summary
                  label="페르소나"
                  value={`${character.personas.length}개`}
                />
                <Summary
                  label="메모리"
                  value={`${character.memories.length}개`}
                />
                <Summary
                  label="비주얼 레퍼런스"
                  value={`${visual.data?.referenceMedia.filter((item) => item.isActive).length ?? 0}개`}
                />
                <Summary
                  label="프로필 이미지"
                  value={profileImage.data?.image ? "등록됨" : "미등록"}
                />
              </div>
            </Stack>
          </Paper>

          <Paper className={classes.panel} p="lg" component="section">
            <Stack gap="md">
              <SectionHeader title="최근 활동" section="activity" />
              {activity.isPending ? (
                <Loader size="sm" aria-label="최근 활동 불러오는 중" />
              ) : activity.data?.items.length ? (
                <ul className={classes.list}>
                  {activity.data.items.map((log) => (
                    <li className={classes.listItem} key={log.id}>
                      <Stack gap={3} miw={0}>
                        <Badge variant="light" color="ink" w="fit-content">
                          {log.actionType}
                        </Badge>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {log.reason || "사유 없음"}
                        </Text>
                      </Stack>
                      <time className={classes.time} dateTime={log.createdAt}>
                        {formatDate(log.createdAt)}
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

function SectionHeader({ title, section }: { title: string; section: string }) {
  return (
    <div className={classes.sectionHeader}>
      <Title order={3} fz="lg">
        {title}
      </Title>
      <Link className={classes.link} to={`?section=${section}`}>
        자세히 보기 →
      </Link>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.summaryItem}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={700} mt={2}>
        {value}
      </Text>
    </div>
  );
}

function runLabel(
  run: Awaited<ReturnType<typeof fetchPostingPolicy>>["lastRun"],
) {
  if (!run) return "실행 기록 없음";
  const label = {
    queued: "대기",
    running: "진행 중",
    completed: "완료",
    failed: "실패",
    cancelled: "취소",
  }[run.status];
  return `${label} · ${formatDate(run.finishedAt ?? run.scheduledAt)} · ${run.attemptCount}회 시도`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
