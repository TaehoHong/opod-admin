import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { LoadMore } from "../../shared/ui/DataPage";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import {
  fetchModels,
  fetchReferenceAgent,
  saveReferenceAgent,
  REFERENCE_STAGES,
  type ReferenceConfig,
  type ReferenceStarters,
  type ReferenceStage,
  type ReferenceStageInput,
} from "./api";
const labels: Record<ReferenceStage, string> = {
  reference_select: "① 원본 선택",
  image_prompt: "② 이미지 프롬프트",
  caption: "③ 캡션",
};
type Props = {
  onDirtyChange: (dirty: boolean) => void;
  onConfigureGeneration?: () => void;
};
export function ReferenceAgentPanel(props: Props) {
  const query = useQuery({
    queryKey: ["reference-post-agent"],
    queryFn: fetchReferenceAgent,
  });
  if (query.isPending)
    return <Text role="status">설정을 불러오는 중입니다.</Text>;
  if (query.error && !query.data)
    return (
      <Stack>
        <OperationErrorAlert
          failure={operationFailure(
            query.error,
            "레퍼런스 Agent 설정을 불러오지 못했습니다.",
          )}
        />
        <Button variant="default" onClick={() => void query.refetch()}>
          다시 시도
        </Button>
      </Stack>
    );
  return query.data ? (
    <ReferenceSettings
      initial={query.data.current}
      starters={query.data.starters}
      {...props}
    />
  ) : null;
}
function ReferenceSettings({
  initial,
  starters,
  onDirtyChange,
  onConfigureGeneration,
}: Props & { initial: ReferenceConfig; starters?: ReferenceStarters }) {
  const client = useQueryClient();
  const models = useCursorList(["post-agent-models"], fetchModels);
  const revision = useRef(initial.revision);
  const valuesFor = (config: ReferenceConfig) => ({
    maxAttempts: String(config.selection.maxAttempts),
    stages: Object.fromEntries(
      REFERENCE_STAGES.map((stage) => [
        stage,
        {
          aiModelId: config.stages?.[stage].aiModelId ?? "",
          systemPrompt:
            config.stages?.[stage].systemPrompt ??
            starters?.[stage].systemPrompt ??
            "",
        },
      ]),
    ) as Record<ReferenceStage, ReferenceStageInput>,
  });
  const form = useForm({
    mode: "uncontrolled",
    initialValues: valuesFor(initial),
  });
  const dirty = form.isDirty();
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const apply = (config: ReferenceConfig) => {
    revision.current = config.revision;
    const values = valuesFor(config);
    form.setValues(values);
    form.resetDirty(values);
  };
  useEffect(() => {
    if (!form.isDirty()) apply(initial);
  }, [initial]);
  const save = useMutation({
    mutationFn: (
      stages: Record<ReferenceStage, ReferenceStageInput> | undefined,
    ) =>
      saveReferenceAgent({
        expectedRevision: revision.current,
        maxAttempts: Number(form.getValues().maxAttempts),
        ...(stages ? { stages } : {}),
      }),
    onSuccess: (config, stages) => {
      if (stages) apply(config);
      else {
        revision.current = config.revision;
        form.setInitialValues({
          ...form.getInitialValues(),
          maxAttempts: String(config.selection.maxAttempts),
        });
        form.resetDirty({
          ...form.getInitialValues(),
          maxAttempts: String(config.selection.maxAttempts),
        });
      }
      client.setQueryData(["reference-post-agent"], {
        current: config,
        starters,
      });
    },
  });
  const reload = useMutation({
    mutationFn: fetchReferenceAgent,
    onSuccess: (data) => {
      apply(data.current);
      client.setQueryData(["reference-post-agent"], data);
      save.reset();
    },
  });
  const saveAll = () => {
    const values = form.getValues();
    const errors: Record<string, string> = {};
    for (const stage of REFERENCE_STAGES) {
      if (!values.stages[stage].aiModelId)
        errors[`stages.${stage}.aiModelId`] = "모델을 선택하세요.";
      if (!values.stages[stage].systemPrompt.trim())
        errors[`stages.${stage}.systemPrompt`] = "시스템 지침을 입력하세요.";
    }
    form.setErrors(errors);
    if (!Object.keys(errors).length) save.mutate(values.stages);
  };
  const options = models.items
    .filter((model) => model.type === "llm")
    .map((model) => ({
      value: model.id,
      label: `${model.provider} / ${model.model}`,
    }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveAll();
      }}
    >
      <Stack gap="lg">
        {!initial.stages ? (
          <Alert color="attention">
            지침 초안입니다. 각 단계의 모델과 지침을 확인하고 저장해야 실행에
            사용할 수 있습니다.
          </Alert>
        ) : null}
        {models.error ? (
          <Stack>
            <OperationErrorAlert
              failure={operationFailure(
                models.error,
                "모델 목록을 불러오지 못했습니다.",
              )}
            />
            <Button variant="default" onClick={() => void models.refetch()}>
              모델 목록 다시 불러오기
            </Button>
          </Stack>
        ) : null}
        {REFERENCE_STAGES.map((stage) => (
          <Paper p="lg" withBorder key={stage}>
            <Stack>
              <Title order={2}>{labels[stage]}</Title>
              {stage === "reference_select" ? (
                <>
                  <Text>회당 후보 이미지 12장</Text>
                  <Select
                    label="최대 탐색 횟수"
                    data={["1", "2", "3"]}
                    allowDeselect={false}
                    key={form.key("maxAttempts")}
                    {...form.getInputProps("maxAttempts")}
                    disabled={save.isPending || reload.isPending}
                  />
                  <Text size="sm" c="dimmed">
                    적합한 원본을 선택하면 즉시 종료
                  </Text>
                  <Group>
                    <Button
                      variant="default"
                      onClick={() => save.mutate(undefined)}
                      loading={save.isPending}
                      disabled={
                        !form.isDirty("maxAttempts") || reload.isPending
                      }
                    >
                      탐색 설정 저장
                    </Button>
                  </Group>
                </>
              ) : null}
              <Select
                label={`${labels[stage]} 모델`}
                placeholder="모델 선택"
                withAsterisk
                searchable
                data={options}
                disabled={
                  models.isPending ||
                  !!models.error ||
                  save.isPending ||
                  reload.isPending
                }
                key={form.key(`stages.${stage}.aiModelId`)}
                {...form.getInputProps(`stages.${stage}.aiModelId`)}
              />
              <Textarea
                label={`${labels[stage]} 시스템 지침`}
                withAsterisk
                autosize
                minRows={6}
                maxRows={20}
                maxLength={50000}
                disabled={save.isPending || reload.isPending}
                key={form.key(`stages.${stage}.systemPrompt`)}
                {...form.getInputProps(`stages.${stage}.systemPrompt`)}
              />
            </Stack>
          </Paper>
        ))}
        <LoadMore
          hasNextPage={!!models.hasNextPage}
          isFetching={models.isFetchingNextPage}
          onLoadMore={() => void models.fetchNextPage()}
        />
        <Paper p="lg" withBorder>
          <Stack>
            <Title order={3}>이미지 생성 모델</Title>
            <Text size="sm">
              {initial.generation
                ? `${initial.generation.provider} / ${initial.generation.effectiveModel} · 저장 버전 ${initial.generation.revision}`
                : "저장된 이미지 생성 모델이 없습니다."}
            </Text>
            <Text size="sm" c="dimmed">
              설정 저장 시 공통 이미지 생성 모델의 현재 버전을 함께 저장합니다.
            </Text>
            {onConfigureGeneration ? (
              <Button variant="default" onClick={onConfigureGeneration}>
                이미지 생성 모델 설정
              </Button>
            ) : null}
          </Stack>
        </Paper>
        {save.error ? (
          <Stack>
            <OperationErrorAlert
              failure={operationFailure(
                save.error,
                "설정을 저장하지 못했습니다.",
              )}
            />
            <Text size="sm">
              입력을 유지했습니다. 다른 곳에서 설정을 변경했다면 최신 설정을
              다시 불러온 뒤 편집하세요.
            </Text>
            <Button
              variant="default"
              onClick={() => reload.mutate()}
              loading={reload.isPending}
            >
              최신 설정 다시 불러오기
            </Button>
          </Stack>
        ) : null}
        {reload.error ? (
          <OperationErrorAlert
            failure={operationFailure(
              reload.error,
              "최신 설정을 불러오지 못했습니다.",
            )}
          />
        ) : null}
        {save.isSuccess ? <Alert color="teal">저장했습니다.</Alert> : null}
        <Group>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={reload.isPending || models.isPending || !!models.error}
          >
            설정 저장
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
