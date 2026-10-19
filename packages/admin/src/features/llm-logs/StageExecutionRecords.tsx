import {
  Accordion,
  Alert,
  Button,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { logDateTime } from "../../shared/ui/LogField";
import { fetchLlmLog, fetchLlmLogs, type LlmLogDetail } from "./api";
import { LlmLogMediaTile, LlmLogPayload } from "./LlmLogPayload";
import classes from "./StageExecutionRecords.module.css";

export type StageExecutionRecordsProps = {
  producerLogId?: string | null;
  producerLogIds?: string[];
  requestId?: string | null;
  generationJobId?: string | null;
  type?: string;
};

export function StageExecutionRecords(props: StageExecutionRecordsProps) {
  const { producerLogId, requestId, generationJobId, type } = props;
  const exactIds = [...new Set(props.producerLogIds?.filter(Boolean) ?? [])];
  if (exactIds.length)
    return <ExactAttemptRecords key={exactIds.join(",")} ids={exactIds} />;
  const scope = producerLogId
    ? { producerLogId }
    : requestId && type
      ? { requestId, type }
      : generationJobId
        ? { generationJobId, type: "admin.image.generate" }
        : null;
  return scope ? (
    <ScopedRecords key={JSON.stringify(scope)} scope={scope} />
  ) : (
    <Text size="sm" c="dimmed">
      실행 기록이 없습니다.
    </Text>
  );
}

function ExactAttemptRecords({ ids }: { ids: string[] }) {
  const [id, setId] = useState(ids[ids.length - 1]);
  return (
    <Stack gap="xs">
      {ids.length > 1 && (
        <NativeSelect
          label="실행 기록"
          value={id}
          onChange={(event) => setId(event.currentTarget.value)}
          data={ids.map((value, index) => ({
            value,
            label: `탐색 ${index + 1}`,
          }))}
        />
      )}
      <ScopedRecords key={id} scope={{ producerLogId: id }} />
    </Stack>
  );
}

type Scope =
  | { producerLogId: string }
  | { requestId: string; type: string }
  | { generationJobId: string; type: string };

function ScopedRecords({ scope }: { scope: Scope }) {
  const [selectedId, setSelectedId] = useState<string>();
  const producerLogId =
    "producerLogId" in scope ? scope.producerLogId : undefined;
  const list = useInfiniteQuery({
    queryKey: ["llm-logs", "stage", scope],
    enabled: !producerLogId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchLlmLogs({ ...scope, cursor: pageParam, limit: "20" }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const id = producerLogId ?? selectedId ?? items[0]?.id;
  const detail = useQuery({
    queryKey: ["llm-logs", "stage-detail", scope, id],
    enabled: !!id,
    queryFn: () => fetchLlmLog(id!),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  });
  if (list.error || detail.error)
    return (
      <Alert color="red" title="실행 기록을 불러오지 못했습니다.">
        <Button
          variant="subtle"
          onClick={() => void (list.error ? list.refetch() : detail.refetch())}
        >
          다시 시도
        </Button>
      </Alert>
    );
  if ((!producerLogId && list.isPending) || (id && detail.isPending))
    return (
      <Text size="sm" c="dimmed" role="status">
        실행 기록을 불러오는 중입니다.
      </Text>
    );
  return (
    <Stack gap="xs">
      {items.length > 1 ? (
        <NativeSelect
          label="실행 기록"
          value={id}
          onChange={(event) => setSelectedId(event.currentTarget.value)}
          data={items.map((item) => ({
            value: item.id,
            label: `${logDateTime(item.createdAt)} · ${item.status === "running" ? "진행 중" : item.status === "failed" ? "실패" : "성공"}`,
          }))}
        />
      ) : null}
      {detail.data ? (
        <ExecutionPayload detail={detail.data} />
      ) : (
        <Text size="sm" c="dimmed">
          실행 기록이 없습니다.
        </Text>
      )}
      {list.hasNextPage ? (
        <Button
          variant="subtle"
          size="xs"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          이전 실행 더 보기
        </Button>
      ) : null}
    </Stack>
  );
}

function ExecutionPayload({ detail }: { detail: LlmLogDetail }) {
  return (
    <Accordion multiple variant="default" classNames={{ item: classes.item }}>
      {(["input", "output"] as const).map((direction) => {
        const value =
          direction === "input" ? detail.requestJson : detail.responseJson;
        const media = detail.media.filter((item) => item.role === direction);
        return (
          <Accordion.Item key={direction} value={direction}>
            <Accordion.Control>
              {direction === "input" ? "입력 원본" : "출력 원본"}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {value == null ? (
                  <Text size="sm" c="dimmed">
                    {direction === "output" && detail.status === "running"
                      ? "실행 중입니다. 출력 원본이 아직 없습니다."
                      : "저장된 원본이 없습니다."}
                  </Text>
                ) : (
                  <LlmLogPayload value={value} />
                )}
                {direction === "input" ? (
                  <>
                    {detail.systemPromptJson != null ? (
                      <>
                        <Text size="xs" c="dimmed">
                          시스템 프롬프트
                        </Text>
                        <LlmLogPayload value={detail.systemPromptJson} />
                      </>
                    ) : null}
                    {detail.userPromptJson != null ? (
                      <>
                        <Text size="xs" c="dimmed">
                          사용자 프롬프트
                        </Text>
                        <LlmLogPayload value={detail.userPromptJson} />
                      </>
                    ) : null}
                  </>
                ) : null}
                {media.length ? (
                  <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                    {media.map((item) => (
                      <LlmLogMediaTile key={item.id} item={item} />
                    ))}
                  </SimpleGrid>
                ) : null}
                {detail.redactedPaths.length ? (
                  <Text size="xs" c="dimmed">
                    민감정보로 가려진 경로: {detail.redactedPaths.join(", ")}
                  </Text>
                ) : null}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion>
  );
}
