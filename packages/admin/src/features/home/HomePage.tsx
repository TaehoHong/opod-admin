import {
  Article,
  CheckCircle,
  CreditCard,
  ImageSquare,
  ShieldCheck,
  Sparkle,
  type Icon,
} from "@phosphor-icons/react";
import {
  Alert,
  Badge,
  Card,
  Group,
  Paper,
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
import classes from "./HomePage.module.css";
import { fetchHomeSummary, fetchRecentActionLogs } from "./api";

const TODOS: Array<{
  key: PendingQueue;
  label: string;
  description: string;
  Icon: Icon;
}> = [
  {
    key: "posts",
    label: "운영이 필요한 게시물",
    description: "생성 단계 실행, 검수 또는 오류 확인",
    Icon: Article,
  },
  {
    key: "moderation",
    label: "미처리 신고",
    description: "검토 후 조치 또는 기각",
    Icon: ShieldCheck,
  },
  {
    key: "payments",
    label: "정산 불일치",
    description: "provider ↔ 원장 상태 불일치",
    Icon: CreditCard,
  },
  {
    key: "generation",
    label: "실패한 생성 작업",
    description: "재시도 필요",
    Icon: Sparkle,
  },
  {
    key: "media",
    label: "미확정 업로드",
    description: "업로드 확정 대기",
    Icon: ImageSquare,
  },
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
      actions={
        <Badge className={classes.dateBadge} variant="outline" size="lg">
          {today}
        </Badge>
      }
      isPending={summary.isPending || pending.isPending}
      error={summary.error}
    >
      {pending.failedQueues.length > 0 ? (
        <Alert color="attention" role="alert" title="일부 대기 건수 집계 실패">
          {pending.failedQueues
            .map((queue) => PENDING_QUEUE_LABEL[queue])
            .join(", ")}{" "}
          — 아래 숫자에 빠져 있습니다.
        </Alert>
      ) : null}

      <div className={classes.layout}>
        <Stack gap="md">
          <div className={classes.sectionHeader}>
            <div>
              <Title className={classes.sectionTitle} order={2}>
                우선 처리
              </Title>
              <Text className={classes.sectionMeta}>
                영향도가 높은 운영 항목부터 정렬했습니다.
              </Text>
            </div>
            {todos.length > 0 ? (
              <Badge color="attention" variant="light">
                {todos.length}개 큐 확인 필요
              </Badge>
            ) : null}
          </div>

          {todos.length === 0 ? (
            <Paper className={classes.emptyQueue} p="lg">
              <Group gap="md" wrap="nowrap">
                <CheckCircle size={30} weight="duotone" aria-hidden />
                <div>
                  <Text fw={700}>처리 대기 항목이 없습니다.</Text>
                  <Text size="sm" c="dimmed">
                    모든 큐가 비어 있습니다.
                  </Text>
                </div>
              </Group>
            </Paper>
          ) : (
            <div className={classes.todoGrid}>
              {todos.map((todo) => (
                <UnstyledButton
                  className={classes.todoButton}
                  key={todo.key}
                  onClick={() => void navigate(`/${todo.key}`)}
                >
                  <Card className={classes.todoCard} padding="lg">
                    <Group wrap="nowrap" gap="md">
                      <span className={classes.todoIcon}>
                        <todo.Icon size={21} weight="duotone" aria-hidden />
                      </span>
                      <Stack gap={2} flex={1} miw={0}>
                        <Text fw={700}>{todo.label} →</Text>
                        <Text size="sm" c="dimmed">
                          {todo.description}
                        </Text>
                      </Stack>
                      <span className={classes.todoNumber}>
                        {pendingCountLabel(pending.data[todo.key])}
                      </span>
                    </Group>
                  </Card>
                </UnstyledButton>
              ))}
            </div>
          )}
        </Stack>

        {summary.data ? (
          <Stack gap="md">
            <div className={classes.sectionHeader}>
              <div>
                <Title className={classes.sectionTitle} order={2}>
                  지금의 OPOD
                </Title>
                <Text className={classes.sectionMeta}>현재 운영 규모 요약</Text>
              </div>
            </div>
            <div className={classes.metricGrid}>
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
                label="진행 중"
                value={String(summary.data.inProgressJobs)}
                note="queued + running"
              />
            </div>
          </Stack>
        ) : null}
      </div>

      <Paper className={classes.logPanel} p="lg">
        <Stack gap="md">
          <div className={classes.sectionHeader}>
            <div>
              <Title className={classes.sectionTitle} order={2}>
                최근 액션 로그
              </Title>
              <Text className={classes.sectionMeta}>
                운영자가 남긴 최근 변경
              </Text>
            </div>
            <Link className={classes.viewAll} to="/logs">
              전체 보기 →
            </Link>
          </div>
          {logs.data?.items.length ? (
            <ul className={classes.logList}>
              {logs.data.items.map((log) => (
                <li className={classes.logItem} key={log.id}>
                  <Badge variant="light" color="ink">
                    {log.actionType}
                  </Badge>
                  <Text size="sm" lineClamp={1}>
                    {log.reason}
                  </Text>
                  <time className={classes.logTime} dateTime={log.createdAt}>
                    {log.createdAt.replace("T", " ").slice(0, 16)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <Text c="dimmed">기록된 액션이 없습니다.</Text>
          )}
        </Stack>
      </Paper>
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
    <Card className={classes.metricCard} padding="md">
      <Stack gap={5}>
        <Text className={classes.metricLabel}>{label}</Text>
        <Text className={classes.metricValue}>{value}</Text>
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      </Stack>
    </Card>
  );
}
