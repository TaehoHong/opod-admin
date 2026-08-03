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
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { TableText } from "../../shared/ui/TableText";
import { fetchCharacterActionLogs } from "./api";

// 자동화가 무엇을 했는지 읽는 화면이라, 실패로 읽히는 액션은 눈에 띄어야 한다
// (docs/04-design-rules.md:67).
function actionColor(actionType: string): string {
  if (actionType.includes("fail") || actionType.includes("error")) return "red";
  if (actionType.includes("create") || actionType.includes("post"))
    return "accent";
  return "gray";
}

export function LogsPage() {
  const [characterId, setCharacterId] = useState("");
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { characterId: "" },
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
          onSubmit={form.onSubmit((values) =>
            setCharacterId(values.characterId.trim()),
          )}
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
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {logs.items.map((log) => (
              <Table.Tr key={log.id}>
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
              </Table.Tr>
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
