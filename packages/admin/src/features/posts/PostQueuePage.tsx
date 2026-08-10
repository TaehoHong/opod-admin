import {
  Anchor,
  Badge,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { TableText } from "../../shared/ui/TableText";
import {
  fetchPostWorkItems,
  type PostWorkFilter,
  type PostWorkItem,
} from "./api";
import styles from "./PostQueuePage.module.css";

const FILTERS: { value: PostWorkFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "needs_action", label: "운영 필요" },
  { value: "agent", label: "Agent 진행" },
  { value: "publish_waiting", label: "게시 대기" },
  { value: "published", label: "게시 완료" },
  { value: "failed", label: "실패" },
];

const STAGE_LABEL: Record<PostWorkItem["currentStage"], string> = {
  brief: "브리프",
  plan: "기획",
  prompt: "프롬프트",
  evaluation: "평가",
  generation: "이미지 생성",
  review: "검수",
  publish: "게시",
  memory: "메모리",
};
const STAGE_NUMBER = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

const STATUS_COLOR: Record<PostWorkItem["operationalStatus"], string> = {
  failed: "red",
  needs_action: "attention",
  publish_waiting: "blue",
  agent_running: "accent",
  completed: "teal",
};

export function PostQueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = validFilter(params.get("filter"));
  const items = useCursorList(["post-work-items", filter], (cursor) =>
    fetchPostWorkItems({ filter, cursor }),
  );

  const open = (item: PostWorkItem) => {
    void navigate(workPath(item));
  };

  return (
    <DataPage
      title="게시물"
      isPending={items.isPending}
      error={items.error}
      isEmpty={items.items.length === 0}
      emptyLabel="조건에 맞는 게시물이 없습니다."
      actions={
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            aria-label="게시물 상태"
            data={FILTERS}
            value={filter}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              if (value === "all") next.delete("filter");
              else next.set("filter", value);
              setParams(next, { replace: true });
            }}
          />
          <Button component={Link} to="/posts/new/brief">
            게시물 만들기
          </Button>
        </Group>
      }
    >
      <Table.ScrollContainer minWidth={980}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>게시물</Table.Th>
              <Table.Th>캐릭터</Table.Th>
              <Table.Th>현재 단계</Table.Th>
              <Table.Th>상태</Table.Th>
              <Table.Th>게시 일정</Table.Th>
              <Table.Th>최근 변경</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.items.map((item) => (
              <Table.Tr
                key={`${item.kind}:${item.id}`}
                className={styles.row}
                tabIndex={0}
                onClick={(event) => onRowClick(event, item, open)}
                onKeyDown={(event) => onRowKeyDown(event, item, open)}
              >
                <Table.Td maw={390}>
                  <Group gap="sm" wrap="nowrap">
                    {item.thumbnailUrl ? (
                      <img
                        className={styles.thumbnail}
                        src={item.thumbnailUrl}
                        alt=""
                      />
                    ) : (
                      <span
                        className={`${styles.thumbnail} ${styles.placeholder}`}
                        aria-hidden="true"
                      >
                        없음
                      </span>
                    )}
                    <Stack gap={3} miw={0}>
                      <Anchor
                        component={Link}
                        to={workPath(item)}
                        fw={600}
                        size="sm"
                      >
                        <TableText lines={1}>
                          {item.caption || "(기획 전)"}
                        </TableText>
                      </Anchor>
                      <Badge variant="light" color="ink" size="xs">
                        {item.contentType}
                      </Badge>
                    </Stack>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <CharacterName id={item.characterId} />
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {STAGE_NUMBER[item.stageIndex - 1]}{" "}
                    {STAGE_LABEL[item.currentStage]} · {item.stageIndex}/8단계
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[item.operationalStatus]}>
                    {item.statusDetail}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {item.scheduledAt
                      ? formatDateTime(item.scheduledAt)
                      : item.currentStage === "memory"
                        ? "게시됨"
                        : "승인 후 즉시"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" title={formatDateTime(item.updatedAt)}>
                    {relativeTime(item.updatedAt)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <LoadMore
        hasNextPage={items.hasNextPage}
        isFetching={items.isFetchingNextPage}
        onLoadMore={() => void items.fetchNextPage()}
      />
    </DataPage>
  );
}

function validFilter(value: string | null): PostWorkFilter {
  return FILTERS.some((filter) => filter.value === value)
    ? (value as PostWorkFilter)
    : "all";
}

function workPath(item: PostWorkItem) {
  return `/posts/${encodeURIComponent(item.id)}/${item.currentStage}`;
}

function onRowClick(
  event: MouseEvent<HTMLTableRowElement>,
  item: PostWorkItem,
  open: (item: PostWorkItem) => void,
) {
  if ((event.target as HTMLElement).closest("a,button,input")) return;
  open(item);
}

function onRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  item: PostWorkItem,
  open: (item: PostWorkItem) => void,
) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  open(item);
}

function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}일 전` : formatDateTime(value);
}
