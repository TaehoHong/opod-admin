import { Alert, Button, Group, Loader, Stack, Title } from "@mantine/core";
import type { ReactNode } from "react";

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
    <Stack>
      <Group justify="space-between" align="center">
        <Title order={3}>{title}</Title>
        {actions}
      </Group>
      {isPending ? <Loader aria-label={`${title} 불러오는 중`} /> : null}
      {error ? (
        <Alert color="red" role="alert" title="불러오지 못했습니다">
          {error.message}
        </Alert>
      ) : null}
      {!isPending && !error && isEmpty ? (
        <Alert color="gray">{emptyLabel}</Alert>
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
    <Group>
      <Button variant="default" onClick={onLoadMore} loading={isFetching}>
        더 보기
      </Button>
    </Group>
  );
}
