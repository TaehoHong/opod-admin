import {
  Badge,
  Button,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { TableText } from "../../shared/ui/TableText";
import { LogRow } from "../../shared/ui/LogRow";
import { ActionLogDetailPage } from "./ActionLogDetailPage";
import { fetchCharacterActionLogs } from "./api";
import { actionColor } from "./actionColor";

export function LogsPage() {
  const { logId } = useParams();
  const location = useLocation();
  if (logId) return <ActionLogDetailPage id={logId} />;
  return <ActionLogList key={location.search} />;
}

function ActionLogList() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const characterId = params.get("characterId") ?? "";
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { characterId },
  });

  const logs = useCursorList(["character-action-logs", characterId], (cursor) =>
    fetchCharacterActionLogs({
      ...(characterId ? { characterId } : {}),
      cursor,
    }),
  );

  return (
    <DataPage
      title="액션 로그"
      isPending={logs.isPending}
      error={logs.error}
      isEmpty={logs.items.length === 0}
      emptyLabel="기록된 액션이 없습니다."
      actions={
        <form
          onSubmit={form.onSubmit((values) => {
            const next = new URLSearchParams(params);
            const value = values.characterId.trim();
            if (value) next.set("characterId", value);
            else next.delete("characterId");
            setParams(next, { replace: true });
          })}
        >
          <Group gap="xs">
            <TextInput
              aria-label="캐릭터 ID"
              placeholder="캐릭터 ID"
              key={form.key("characterId")}
              {...form.getInputProps("characterId")}
            />
            <Button type="submit" variant="default">
              조회
            </Button>
          </Group>
        </form>
      }
    >
      <Table.ScrollContainer minWidth={880}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>액션</Table.Th>
              <Table.Th>캐릭터</Table.Th>
              <Table.Th>대상</Table.Th>
              <Table.Th>사유</Table.Th>
              <Table.Th>일시</Table.Th>
              <Table.Th>상세</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {logs.items.map((log) => (
              <LogRow
                key={log.id}
                to={`/logs/${encodeURIComponent(log.id)}${location.search}`}
              >
                <Table.Td>
                  <Badge variant="light" color={actionColor(log.actionType)}>
                    {log.actionType}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <CharacterName id={log.characterId} />
                </Table.Td>
                <Table.Td>
                  <Stack gap={0}>
                    <Text>{log.targetTable ?? "—"}</Text>
                    {log.targetId ? (
                      <Text size="xs" c="dimmed">
                        {log.targetId}
                      </Text>
                    ) : null}
                  </Stack>
                </Table.Td>
                <Table.Td maw={320}>
                  <TableText>{log.reason}</TableText>
                </Table.Td>
                <Table.Td>
                  {log.createdAt.replace("T", " ").slice(0, 16)}
                </Table.Td>
                <Table.Td>
                  <Button
                    component={Link}
                    to={`/logs/${encodeURIComponent(log.id)}${location.search}`}
                    variant="subtle"
                    size="compact-sm"
                  >
                    상세
                  </Button>
                </Table.Td>
              </LogRow>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <LoadMore
        hasNextPage={logs.hasNextPage}
        isFetching={logs.isFetchingNextPage}
        onLoadMore={() => void logs.fetchNextPage()}
      />
    </DataPage>
  );
}
