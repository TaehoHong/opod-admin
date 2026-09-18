import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ArrowDown, Tray } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import classes from "./DataPage.module.css";

// 목록 화면이 13개 반복되고 같은 이유로 바뀌므로 공통화한다
// (docs/04-design-rules.md:50 — 실제 반복이 생겼을 때만 공통 component).
//
// 화면은 진행 중 / 실패 / 결과를 구분해서 보여준다
// (docs/04-design-rules.md "Interaction").

export function DataPage({
  title,
  actions,
  isPending,
  error,
  isEmpty,
  emptyLabel = "표시할 항목이 없습니다.",
  children,
}: {
  title: string;
  actions?: ReactNode;
  isPending: boolean;
  error?: Error | null;
  isEmpty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  return (
    <Stack className={classes.page} gap="xl">
      <header className={classes.header}>
        <div className={classes.titleBlock}>
          <div className={classes.kicker}>OPOD operations</div>
          <Title className={classes.title} order={1}>
            {title}
          </Title>
        </div>
        {actions ? <div className={classes.actions}>{actions}</div> : null}
      </header>
      {isPending ? (
        <Paper className={classes.state} p="lg" role="status">
          <Group h="100%" gap="md" wrap="nowrap">
            <span className={classes.stateIcon}>
              <Loader size="sm" aria-hidden />
            </span>
            <Stack gap={2}>
              <Text fw={700}>{title} 불러오는 중…</Text>
              <Text size="sm" c="dimmed">
                최신 운영 데이터를 확인하고 있습니다.
              </Text>
            </Stack>
          </Group>
        </Paper>
      ) : null}
      {error ? (
        <Alert color="red" role="alert" title="불러오지 못했습니다">
          {error.message}
        </Alert>
      ) : null}
      {!isPending && !error && isEmpty ? (
        <Paper className={classes.state} p="lg" role="status">
          <Group h="100%" gap="md" wrap="nowrap">
            <span className={classes.stateIcon}>
              <Tray size={20} aria-hidden />
            </span>
            <Stack gap={2}>
              <Text fw={700}>{emptyLabel}</Text>
              <Text size="sm" c="dimmed">
                조건을 바꾸거나 새 항목을 추가해 보세요.
              </Text>
            </Stack>
          </Group>
        </Paper>
      ) : null}
      {!isPending && !error && !isEmpty ? children : null}
    </Stack>
  );
}

// cursor 페이지네이션의 "더 보기". pending 동안 재실행을 막는다
// (docs/04-design-rules.md:68).
export function LoadMore({
  hasNextPage,
  isFetching,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}) {
  if (!hasNextPage) return null;
  return (
    <Group className={classes.loadMore}>
      <Button
        variant="default"
        leftSection={<ArrowDown size={16} aria-hidden />}
        onClick={onLoadMore}
        loading={isFetching}
      >
        더 보기
      </Button>
    </Group>
  );
}
