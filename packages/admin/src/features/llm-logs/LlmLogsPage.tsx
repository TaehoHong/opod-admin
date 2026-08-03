import {
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { useDetailSelection } from "../../shared/routing/useDetailSelection";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterName, shortId } from "../../shared/ui/EntityName";
import { LlmLogDetailPanel } from "./LlmLogDetailPanel";
import { TokenUsagePanel } from "./TokenUsagePanel";
import { fetchLlmLogs, type LlmLogStatus } from "./api";

const STATUS_FILTER = [
  { value: "", label: "전체" },
  { value: "running", label: "진행 중" },
  { value: "succeeded", label: "성공" },
  { value: "failed", label: "실패" },
];

const STATUS_LABEL: Record<LlmLogStatus, string> = {
  running: "진행 중",
  succeeded: "성공",
  failed: "실패",
};

const STATUS_COLOR: Record<LlmLogStatus, string> = {
  running: "attention",
  succeeded: "teal",
  failed: "red",
};

export function LlmLogsPage() {
  return (
    <Tabs defaultValue="calls" keepMounted={false}>
      <Tabs.List mb="md">
        <Tabs.Tab value="calls">호출 로그</Tabs.Tab>
        <Tabs.Tab value="usage">토큰 사용량</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="calls">
        <LlmLogList />
      </Tabs.Panel>
      <Tabs.Panel value="usage">
        <TokenUsagePanel />
      </Tabs.Panel>
    </Tabs>
  );
}

function LlmLogList() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState({ type: "", provider: "", model: "" });
  const { selectedId, toggle, close } = useDetailSelection(
    "logId",
    "/llm-logs",
  );

  const form = useForm({
    mode: "uncontrolled",
    initialValues: { type: "", provider: "", model: "" },
  });

  const logs = useCursorList(
    ["llm-logs", status, search.type, search.provider, search.model],
    (cursor) =>
      fetchLlmLogs({
        ...(status ? { status } : {}),
        ...(search.type ? { type: search.type } : {}),
        ...(search.provider ? { provider: search.provider } : {}),
        ...(search.model ? { model: search.model } : {}),
        cursor,
      }),
  );

  return (
    <DataPage
      title="LLM 로그"
      isPending={logs.isPending}
      error={logs.error}
      isEmpty={logs.items.length === 0}
      emptyLabel="조건에 맞는 호출이 없습니다."
      actions={
        <form
          onSubmit={form.onSubmit((values) => {
            setSearch({
              type: values.type.trim(),
              provider: values.provider.trim(),
              model: values.model.trim(),
            });
            close();
          })}
        >
          <Group gap="xs">
            <Select
              aria-label="호출 상태"
              data={STATUS_FILTER}
              value={status}
              onChange={(value) => {
                setStatus(value ?? "");
                close();
              }}
              allowDeselect={false}
              w={120}
            />
            <TextInput
              aria-label="호출 종류"
              placeholder="종류"
              w={160}
              key={form.key("type")}
              {...form.getInputProps("type")}
            />
            <TextInput
              aria-label="provider"
              placeholder="provider"
              w={120}
              key={form.key("provider")}
              {...form.getInputProps("provider")}
            />
            <TextInput
              aria-label="model"
              placeholder="model"
              w={140}
              key={form.key("model")}
              {...form.getInputProps("model")}
            />
            <Button type="submit" variant="default">
              조회
            </Button>
          </Group>
        </form>
      }
    >
      <Table.ScrollContainer minWidth={1140}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>상태</Table.Th>
              <Table.Th>종류</Table.Th>
              <Table.Th>provider · model</Table.Th>
              <Table.Th>연결</Table.Th>
              <Table.Th>토큰</Table.Th>
              <Table.Th>미디어</Table.Th>
              <Table.Th>소요</Table.Th>
              <Table.Th>일시</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {logs.items.map((log) => (
              <Table.Tr key={log.id}>
                <Table.Td>
                  <Badge color={STATUS_COLOR[log.status]}>
                    {STATUS_LABEL[log.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>{log.type}</Table.Td>
                <Table.Td>
                  <Stack gap={0}>
                    <Text>{log.provider}</Text>
                    <Text size="xs" c="dimmed">
                      {log.model}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  {/* 어떤 생성 작업이 부른 호출인지가 로그를 읽는 출발점이다. */}
                  {log.generationJobId ? (
                    <Text size="xs" c="dimmed" title={log.generationJobId}>
                      job {shortId(log.generationJobId)}
                    </Text>
                  ) : log.characterId ? (
                    <CharacterName id={log.characterId} size="xs" />
                  ) : (
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{log.totalTokens?.toLocaleString() ?? "—"}</Table.Td>
                <Table.Td>
                  {log.mediaCount > 0 ? `${log.mediaCount}장` : "—"}
                </Table.Td>
                <Table.Td>
                  {log.durationMs === null
                    ? "—"
                    : `${log.durationMs.toLocaleString()} ms`}
                </Table.Td>
                <Table.Td>
                  {log.createdAt.replace("T", " ").slice(0, 16)}
                </Table.Td>
                <Table.Td>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => toggle(log.id)}
                  >
                    {selectedId === log.id ? "닫기" : "상세"}
                  </Button>
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
      {selectedId ? <LlmLogDetailPanel id={selectedId} /> : null}
    </DataPage>
  );
}
