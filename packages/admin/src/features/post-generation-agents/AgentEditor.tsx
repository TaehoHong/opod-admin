import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { LoadMore } from "../../shared/ui/DataPage";
import { useCursorList } from "../../shared/api/useCursorList";
import {
  fetchHistory,
  restoreAgent,
  saveAgent,
  type AgentConfig,
  type AiModel,
  LABELS,
} from "./api";
import classes from "./PostAgentsPage.module.css";
type Values = { aiModelId: string; model: string; systemPrompt: string };
type Draft = {
  values: Values;
  expectedRevision: number;
  outputSchema: unknown;
};
const storageKey = (stage: string) => `opod:post-agent-draft:${stage}`;
function readDraft(config: AgentConfig): Draft {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(storageKey(config.stage)) ?? "null",
    ) as Draft | null;
    if (
      value &&
      typeof value.expectedRevision === "number" &&
      typeof value.values?.systemPrompt === "string" &&
      typeof value.values.aiModelId === "string" &&
      typeof value.values.model === "string"
    )
      return value;
  } catch {
    /* Keep the form usable when browser storage is unavailable. */
  }
  return {
    values: {
      aiModelId: config.aiModelId ?? "",
      model: config.model ?? "",
      systemPrompt: config.systemPrompt ?? "",
    },
    expectedRevision: config.revision,
    outputSchema: config.outputSchema,
  };
}
export function AgentEditor({
  config,
  models,
  onDirtyChange,
  onSaved,
}: {
  config: AgentConfig;
  models: AiModel[];
  onDirtyChange: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const cache = useQueryClient();
  const [initial] = useState(() => readDraft(config));
  const [expectedRevision, setExpectedRevision] = useState(
    initial.expectedRevision,
  );
  const [outputSchema, setOutputSchema] = useState(initial.outputSchema);
  const clean = useRef({
    aiModelId: config.aiModelId ?? "",
    model: config.model ?? "",
    systemPrompt: config.systemPrompt ?? "",
  });
  const isImage = config.stage === "generation";
  const [preview, setPreview] = useState<AgentConfig | null>(null);
  const [confirmation, setConfirmation] = useState<"restore" | null>(null);
  const form = useForm<Values>({
    mode: "uncontrolled",
    initialValues: initial.values,
    validate: {
      aiModelId: (value) => (value ? null : "기본 모델을 선택하세요."),
      systemPrompt: (value) =>
        isImage || value.trim() ? null : "시스템 지침을 입력하세요.",
    },
    onValuesChange: (values) => {
      const dirty = JSON.stringify(values) !== JSON.stringify(clean.current);
      onDirtyChange(dirty);
      try {
        if (dirty)
          sessionStorage.setItem(
            storageKey(config.stage),
            JSON.stringify({ values, expectedRevision, outputSchema }),
          );
        else sessionStorage.removeItem(storageKey(config.stage));
      } catch {
        /* Input remains in the mounted form. */
      }
    },
  });
  useEffect(() => {
    onDirtyChange(
      JSON.stringify(initial.values) !== JSON.stringify(clean.current),
    );
    // Each stage mounts its own editor; restored drafts also need navigation protection.
  }, [initial, onDirtyChange]);
  const accepted = (saved: AgentConfig) => {
    const values = {
      aiModelId: saved.aiModelId ?? "",
      model: saved.model ?? "",
      systemPrompt: saved.systemPrompt ?? "",
    };
    clean.current = values;
    form.setValues(values);
    form.resetDirty(values);
    setExpectedRevision(saved.revision);
    setOutputSchema(saved.outputSchema);
    onDirtyChange(false);
    try {
      sessionStorage.removeItem(storageKey(config.stage));
    } catch {
      /* No stored draft to remove. */
    }
    cache.setQueryData<{ items: AgentConfig[] }>(["post-agents"], (data) =>
      data
        ? {
            items: data.items.map((item) =>
              item.stage === saved.stage ? saved : item,
            ),
          }
        : data,
    );
    void cache.invalidateQueries({
      queryKey: ["post-agent-history", config.stage],
    });
    setConfirmation(null);
    setPreview(null);
    onSaved?.();
  };
  const save = useMutation({
    mutationFn: (values: Values) =>
      saveAgent(config.stage, {
        expectedRevision,
        aiModelId: values.aiModelId,
        model: values.model.trim() || null,
        systemPrompt: isImage ? null : values.systemPrompt,
        outputSchema: isImage ? null : outputSchema,
      }),
    onSuccess: accepted,
  });
  const restore = useMutation({
    mutationFn: () =>
      restoreAgent(config.stage, preview!.id!, expectedRevision),
    onSuccess: accepted,
  });
  const busy = save.isPending || restore.isPending;
  const error = save.error ?? restore.error;
  const history = useCursorList(
    ["post-agent-history", config.stage],
    (cursor) => fetchHistory(config.stage, cursor),
  );
  const options = models
    .filter((model) => model.type === (isImage ? "image" : "llm"))
    .map((model) => ({
      value: model.id,
      label: `${model.provider} / ${model.model}`,
    }));
  if (
    config.aiModelId &&
    !options.some((option) => option.value === config.aiModelId)
  )
    options.unshift({
      value: config.aiModelId,
      label: `${config.provider} / ${config.effectiveModel} (현재 설정)`,
    });
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Stack gap={4}>
          <Title order={2}>{LABELS[config.stage]}</Title>
          <Text size="sm">
            현재 모델:{" "}
            {config.provider && config.effectiveModel
              ? `${config.provider} / ${config.effectiveModel}`
              : "모델 설정 필요"}
          </Text>
        </Stack>
        <Badge variant="light">
          {config.revision ? `버전 ${config.revision}` : "미설정"}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed">
        저장한 설정은 다음 실행부터 사용합니다. 이미지 설정은 새 프롬프트
        생성부터 적용됩니다.
      </Text>
      {!config.id && !isImage ? (
        <Alert color="attention" role="alert">
          저장된 지침이 없습니다. 모델과 시스템 지침을 저장해야 이 단계를 실행할
          수 있습니다.
        </Alert>
      ) : null}
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="md">
          <Select
            label="기본 모델"
            description="모델 목록에서 공급자와 기본 모델명을 함께 선택합니다."
            searchable
            data={options}
            key={form.key("aiModelId")}
            {...form.getInputProps("aiModelId")}
            disabled={busy}
          />
          <TextInput
            label="모델명 override"
            description="비워 두면 선택한 기본 모델명을 사용합니다. 공급자는 기본 모델의 설정을 사용합니다."
            maxLength={512}
            key={form.key("model")}
            {...form.getInputProps("model")}
            disabled={busy}
          />
          {!isImage ? (
            <Textarea
              label="시스템 지침"
              description="이 단계의 Agent에 전달할 지침 전문입니다."
              autosize
              minRows={14}
              maxRows={30}
              maxLength={50000}
              key={form.key("systemPrompt")}
              {...form.getInputProps("systemPrompt")}
              disabled={busy}
            />
          ) : (
            <Text>
              컷별 이미지 프롬프트와 레퍼런스는 앞 단계의 생성 결과를
              사용합니다.
            </Text>
          )}
          {!isImage ? (
            <Accordion>
              <Accordion.Item value="schema">
                <Accordion.Control>출력 JSON 규격</Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" mb="sm">
                    LLM 요청에 전달됩니다. 출력 필드 변경은 코드의 다음 단계
                    처리와 함께 수정해야 합니다.
                  </Text>
                  <Code block className={classes.code}>
                    {JSON.stringify(outputSchema, null, 2)}
                  </Code>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          ) : null}
          {expectedRevision !== config.revision ? (
            <Alert color="attention" role="alert">
              입력을 작성한 뒤 서버 설정이 변경되었습니다. 입력을 보관한 상태로
              새 설정을 확인하세요.
              <Accordion mt="sm">
                <Accordion.Item value="latest">
                  <Accordion.Control>서버의 최신 설정 보기</Accordion.Control>
                  <Accordion.Panel>
                    <Text>
                      버전 {config.revision} · {config.provider} /{" "}
                      {config.effectiveModel}
                    </Text>
                    {config.systemPrompt ? (
                      <Code block className={classes.code}>
                        {config.systemPrompt}
                      </Code>
                    ) : null}
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <Button
                mt="sm"
                variant="default"
                onClick={() => {
                  setExpectedRevision(config.revision);
                  setOutputSchema(config.outputSchema);
                  save.reset();
                  restore.reset();
                  try {
                    sessionStorage.setItem(
                      storageKey(config.stage),
                      JSON.stringify({
                        values: form.getValues(),
                        expectedRevision: config.revision,
                        outputSchema: config.outputSchema,
                      }),
                    );
                  } catch {
                    /* Keep input available without browser storage. */
                  }
                }}
              >
                입력 유지하고 최신 버전 기준으로 편집
              </Button>
            </Alert>
          ) : null}
          {error ? (
            <Alert color="red" role="alert" title="설정을 적용하지 못했습니다">
              <Stack gap="xs">
                <Text>{error.message}</Text>
                <Button
                  variant="default"
                  onClick={() =>
                    void cache.invalidateQueries({ queryKey: ["post-agents"] })
                  }
                >
                  최신 설정 확인
                </Button>
              </Stack>
            </Alert>
          ) : null}
          <Group>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={restore.isPending}
            >
              저장하고 적용
            </Button>
            {save.isSuccess || restore.isSuccess ? (
              <Text role="status" size="sm" c="teal">
                적용했습니다.
              </Text>
            ) : null}
          </Group>
        </Stack>
      </form>
      <Stack gap="sm">
        <Title order={3}>변경 이력</Title>
        {history.error ? (
          <Alert role="alert" color="red">
            {history.error.message}
            <Button variant="default" onClick={() => void history.refetch()}>
              다시 시도
            </Button>
          </Alert>
        ) : null}
        {history.isPending ? (
          <Text role="status">변경 이력 불러오는 중…</Text>
        ) : !history.items.length ? (
          <Text c="dimmed">저장한 버전이 없습니다.</Text>
        ) : (
          <Table.ScrollContainer minWidth={480}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>버전</Table.Th>
                  <Table.Th>모델</Table.Th>
                  <Table.Th>저장 시각</Table.Th>
                  <Table.Th>설정</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.items.map((version) => (
                  <Table.Tr key={version.id}>
                    <Table.Td>{version.revision}</Table.Td>
                    <Table.Td>
                      {version.provider} / {version.effectiveModel}
                    </Table.Td>
                    <Table.Td>
                      {version.createdAt
                        ? new Date(version.createdAt).toLocaleString("ko-KR")
                        : "—"}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => setPreview(version)}
                      >
                        버전 {version.revision} 보기
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <LoadMore
          hasNextPage={!!history.hasNextPage}
          isFetching={history.isFetchingNextPage}
          onLoadMore={() => void history.fetchNextPage()}
        />
      </Stack>
      <Modal
        opened={!!preview}
        onClose={() => !busy && setPreview(null)}
        title={`버전 ${preview?.revision ?? ""} 설정`}
        size="xl"
        closeButtonProps={{ "aria-label": "버전 상세 닫기" }}
      >
        <Stack>
          <Text>
            {preview?.provider} / {preview?.effectiveModel}
          </Text>
          {preview?.systemPrompt ? (
            <Textarea
              label="저장된 시스템 지침"
              value={preview.systemPrompt}
              readOnly
              autosize
              minRows={8}
              maxRows={20}
            />
          ) : null}
          <Button
            variant="default"
            disabled={busy}
            onClick={() => setConfirmation("restore")}
          >
            이 버전 복원
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!confirmation}
        closeButtonProps={{ "aria-label": "적용 취소" }}
        onClose={() => !busy && setConfirmation(null)}
        title="이전 버전 적용"
      >
        <Stack>
          <Text>
            {`버전 ${preview?.revision}의 지침과 모델을 새 버전으로 적용합니다.`}{" "}
            수정 중인 입력도 적용한 설정으로 바뀝니다.
          </Text>
          {error ? (
            <Alert color="red" role="alert">
              {error.message}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              취소
            </Button>
            <Button loading={busy} onClick={() => restore.mutate()}>
              확인하고 적용
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
