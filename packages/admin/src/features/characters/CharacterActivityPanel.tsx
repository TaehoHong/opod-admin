import { Alert, Badge, Loader, Stack, Text } from "@mantine/core";
import { useCursorList } from "../../shared/api/useCursorList";
import { LoadMore } from "../../shared/ui/DataPage";
import { fetchCharacterActionLogs } from "./api";

export function CharacterActivityPanel({
  characterId,
}: {
  characterId: string;
}) {
  const logs = useCursorList(["character-action-logs", characterId], (cursor) =>
    fetchCharacterActionLogs({ characterId, cursor, limit: "30" }),
  );

  if (logs.isPending) {
    return <Loader aria-label="캐릭터 활동 불러오는 중" />;
  }
  if (logs.error) {
    return (
      <Alert color="red" role="alert" title="활동을 불러오지 못했습니다">
        {logs.error.message}
      </Alert>
    );
  }
  if (logs.items.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        기록된 활동이 없습니다.
      </Text>
    );
  }

  return (
    <Stack>
      {logs.items.map((log) => (
        <Stack
          key={log.id}
          gap={4}
          pb="sm"
          style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
        >
          <Stack gap={4}>
            <Badge variant="light" w="fit-content">
              {log.actionType}
            </Badge>
            <Text size="sm">{log.reason || "사유 없음"}</Text>
          </Stack>
          <Text size="xs" c="dimmed">
            {targetLabel(log.targetTable, log.targetId)} ·{" "}
            {formatDateTime(log.createdAt)}
          </Text>
        </Stack>
      ))}
      <LoadMore
        hasNextPage={logs.hasNextPage}
        isFetching={logs.isFetchingNextPage}
        onLoadMore={() => void logs.fetchNextPage()}
      />
    </Stack>
  );
}

function targetLabel(table?: string, id?: string) {
  if (!table && !id) return "대상 없음";
  return `${table ?? "대상"}${id ? ` · ${shortId(id)}` : ""}`;
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
