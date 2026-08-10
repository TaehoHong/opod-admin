import {
  Alert,
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  PENDING_QUEUE_LABEL,
  pendingCountLabel,
  usePendingCounts,
  type PendingQueue,
} from "../../shared/api/usePendingCounts";
import { DataPage } from "../../shared/ui/DataPage";
import { fetchHomeSummary, fetchRecentActionLogs } from "./api";

// 처리 대기 항목을 먼저 보여준다. 순서는 방치되면 손해가 큰 순이다.
const TODOS: Array<{ key: PendingQueue; label: string; description: string }> =
  [
    {
      key: "posts",
      label: "운영이 필요한 게시물",
      description: "생성 단계 실행, 검수 또는 오류 확인",
    },
    {
      key: "moderation",
      label: "미처리 신고",
      description: "검토 후 조치 또는 기각",
    },
    {
      key: "payments",
      label: "정산 불일치",
      description: "provider ↔ 원장 상태 불일치",
    },
    {
      key: "generation",
      label: "실패한 생성 작업",
      description: "재시도 필요",
    },
    { key: "media", label: "미확정 업로드", description: "업로드 확정 대기" },
  ];

export function HomePage() {
  const navigate = useNavigate();
  const pending = usePendingCounts();
  const summary = useQuery({
    queryKey: ["home", "summary"],
    queryFn: fetchHomeSummary,
  });
  const logs = useQuery({
    queryKey: ["home", "recent-logs"],
    queryFn: fetchRecentActionLogs,
  });

  const todos = TODOS.filter(
    (todo) => (pending.data[todo.key]?.count ?? 0) > 0,
  );
  const today = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full" }).format(
    new Date(),
  );

  return (
    <DataPage
      title="오늘의 운영 데스크"
      isPending={summary.isPending || pending.isPending}
      error={summary.error}
    >
      <Text size="sm" c="dimmed" mt={-8}>
        {today} — 처리 대기 항목을 먼저 확인하세요
      </Text>

      {/* 집계에 실패한 큐는 0으로 접지 않고 이름을 밝힌다. 대기 항목이 없는
          것과 세지 못한 것은 운영 판단이 전혀 다르다. */}
      {pending.failedQueues.length > 0 ? (
        <Alert color="attention" role="alert" title="일부 대기 건수 집계 실패">
          {pending.failedQueues
            .map((queue) => PENDING_QUEUE_LABEL[queue])
            .join(", ")}{" "}
          — 아래 숫자에 빠져 있습니다.
        </Alert>
      ) : null}

      {todos.length === 0 ? (
        <Text c="dimmed">
          처리 대기 항목이 없습니다. 모든 큐가 비어 있습니다.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {todos.map((todo) => (
            <UnstyledButton
              key={todo.key}
              onClick={() => void navigate(`/${todo.key}`)}
            >
              <Card padding="md">
                <Group align="flex-start" wrap="nowrap" gap="md">
                  <Text fz={32} fw={600} ff="monospace" lh={1}>
                    {pendingCountLabel(pending.data[todo.key])}
                  </Text>
                  <Stack gap={2}>
                    <Text fw={600}>{todo.label} →</Text>
                    <Text size="xs" c="dimmed">
                      {todo.description}
                    </Text>
                  </Stack>
                </Group>
              </Card>
            </UnstyledButton>
          ))}
        </SimpleGrid>
      )}

      {summary.data ? (
        <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="md">
          <Stat
            label="활성 캐릭터"
            value={String(summary.data.activeCharacters)}
            note={`조회 ${countLabel(summary.data.characters)}명 중`}
          />
          <Stat
            label="게시물"
            value={countLabel(summary.data.posts)}
            note="캐릭터 명의"
          />
          <Stat
            label="사용자"
            value={countLabel(summary.data.users)}
            note="사람 계정"
          />
          <Stat
            label="진행 중 작업"
            value={String(summary.data.inProgressJobs)}
            note="queued + running"
          />
        </SimpleGrid>
      ) : null}

      <Stack gap="xs" maw={720}>
        <Group justify="space-between" align="baseline">
          <Title order={5}>최근 액션 로그</Title>
          <Text component={Link} to="/logs" size="sm" c="accent.6">
            전체 보기 →
          </Text>
        </Group>
        {logs.data?.items.length ? (
          logs.data.items.map((log) => (
            <Group key={log.id} gap="sm" wrap="nowrap" align="baseline">
              <Badge variant="light" style={{ flexShrink: 0 }}>
                {log.actionType}
              </Badge>
              <Text size="sm" lineClamp={1}>
                {log.reason}
              </Text>
              <Text size="xs" c="dimmed" ml="auto" style={{ flexShrink: 0 }}>
                {log.createdAt.replace("T", " ").slice(0, 16)}
              </Text>
            </Group>
          ))
        ) : (
          <Text c="dimmed">기록된 액션이 없습니다.</Text>
        )}
      </Stack>
    </DataPage>
  );
}

function countLabel(tally: { count: number; hasMore: boolean }): string {
  return tally.hasMore ? `${tally.count}+` : String(tally.count);
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text fz={36} fw={600} ff="monospace" lh={1.1}>
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {note}
      </Text>
    </Stack>
  );
}
