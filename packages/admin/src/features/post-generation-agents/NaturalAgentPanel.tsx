import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBeforeUnload } from "react-router-dom";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import {
  fetchNaturalAgent,
  saveNaturalAgent,
  type AgentConfig,
  type AiModel,
  type NaturalConfig,
  type NaturalStage,
} from "./api";
import classes from "./PostAgentsPage.module.css";

const labels: Record<NaturalStage, string> = {
  post_plan: "게시물 기획",
  image_plan: "이미지 기획 · 레퍼런스 검토",
  image_prompt: "이미지 프롬프트",
  naturalness: "사진 자연스러움 검수",
  requirements: "정체성·요구사항 검수",
  caption: "캡션",
};
type Props = {
  models: AiModel[];
  modelsPending?: boolean;
  modelsError?: Error | null;
  generation?: AgentConfig;
  onRetryModels?: () => void;
  onManageModels?: () => void;
  onConfigureGeneration?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};
export function NaturalAgentPanel(props: Props) {
  const config = useQuery({
    queryKey: ["natural-post-agent"],
    queryFn: fetchNaturalAgent,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  if (config.error)
    return (
      <Stack>
        <OperationErrorAlert
          failure={{
            ...operationFailure(
              config.error,
              "새 Agent 설정을 불러오지 못했습니다.",
            ),
            nextAction:
              "다시 불러온 뒤 설정을 확인하세요. 입력 초안은 보관됩니다.",
          }}
        />
        <Button variant="default" onClick={() => void config.refetch()}>
          새 Agent 설정 다시 불러오기
        </Button>
      </Stack>
    );
  if (!config.data)
    return <Text role="status">새 Agent 설정을 불러오는 중…</Text>;
  return (
    <NaturalEditor
      key={config.data.current?.revision ?? "unconfigured"}
      {...props}
      current={config.data.current}
      starters={config.data.starters}
    />
  );
}
function NaturalEditor({
  current,
  starters,
  models,
  generation,
  modelsPending,
  modelsError,
  onRetryModels,
  onManageModels,
  onConfigureGeneration,
  onDirtyChange,
}: Props & {
  current: NaturalConfig | null;
  starters: Record<NaturalStage, string>;
}) {
  const cache = useQueryClient();
  const clean = {
    schedulerDefault: current?.schedulerDefault ?? false,
    planningAiModelId: current?.planningModel.aiModelId ?? "",
    reviewAiModelId: current?.reviewModel.aiModelId ?? "",
    prompts: current?.prompts ?? starters,
  };
  const [initial] = useState(() => {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem("natural-agent-edit") ?? "null",
      ) as { values?: typeof clean; expectedRevision?: string | null } | null;
      if (
        stored?.values &&
        typeof stored.values.planningAiModelId === "string" &&
        typeof stored.values.reviewAiModelId === "string" &&
        typeof stored.values.schedulerDefault === "boolean" &&
        Object.keys(labels).every(
          (stage) =>
            typeof stored.values?.prompts?.[stage as NaturalStage] === "string",
        )
      )
        return stored;
    } catch {
      /* Keep input available without browser storage. */
    }
    return { values: clean, expectedRevision: current?.revision ?? null };
  });
  const [expectedRevision, setExpectedRevision] = useState(
    initial.expectedRevision ?? null,
  );
  const [latest, setLatest] = useState<NaturalConfig | null>(null);
  const [summary, setSummary] = useState<Record<string, string>>({});
  const summaryRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    onDirtyChange?.(JSON.stringify(initial.values) !== JSON.stringify(clean));
  }, []);
  const focusSummary = () =>
    requestAnimationFrame(() => summaryRef.current?.focus());
  useEffect(() => {
    if (generation?.id)
      setSummary((errors) => {
        if (!errors.generation) return errors;
        const next = { ...errors };
        delete next.generation;
        return next;
      });
  }, [generation?.id]);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: initial.values!,
    onValuesChange: (values) => {
      setSummary((errors) =>
        Object.fromEntries(
          Object.entries(errors).filter(([field]) => {
            if (field === "planningAiModelId") return !values.planningAiModelId;
            if (field === "reviewAiModelId") return !values.reviewAiModelId;
            if (field.startsWith("prompts."))
              return !values.prompts[field.slice(8) as NaturalStage]?.trim();
            return true;
          }),
        ),
      );
      onDirtyChange?.(JSON.stringify(values) !== JSON.stringify(clean));
      try {
        sessionStorage.setItem(
          "natural-agent-edit",
          JSON.stringify({ values, expectedRevision }),
        );
      } catch {
        /* Keep mounted input. */
      }
    },
    validate: (values) => {
      const errors: Record<string, string> = {};
      if (!values.planningAiModelId)
        errors.planningAiModelId = "기획·캡션 모델을 선택하세요.";
      if (!values.reviewAiModelId)
        errors.reviewAiModelId = "사진 검수 모델을 선택하세요.";
      for (const stage of Object.keys(labels) as NaturalStage[])
        if (!values.prompts[stage]?.trim())
          errors[`prompts.${stage}`] = `${labels[stage]} 지침을 입력하세요.`;
      return errors;
    },
  });
  useBeforeUnload((event) => {
    if (form.isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const reload = useMutation({
    mutationFn: fetchNaturalAgent,
    onSuccess: (value) => {
      setLatest(value.current);
      setExpectedRevision(value.current?.revision ?? null);
      try {
        sessionStorage.setItem(
          "natural-agent-edit",
          JSON.stringify({
            values: form.getValues(),
            expectedRevision: value.current?.revision ?? null,
          }),
        );
      } catch {
        /* Keep mounted input. */
      }
    },
  });
  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      saveNaturalAgent({ ...values, expectedRevision }),
    onSuccess: (saved) => {
      form.resetDirty();
      onDirtyChange?.(false);
      setSummary({});
      try {
        sessionStorage.removeItem("natural-agent-edit");
      } catch {
        /* Saved settings remain available. */
      }
      cache.setQueryData(["natural-post-agent"], { current: saved, starters });
    },
  });
  const options = models
    .filter((model) => model.type === "llm")
    .map((model) => ({
      value: model.id,
      label: `${model.provider} / ${model.model}`,
    }));
  for (const model of [current?.planningModel, current?.reviewModel])
    if (model && !options.some((option) => option.value === model.aiModelId))
      options.push({
        value: model.aiModelId,
        label: `${model.provider} / ${model.model}`,
      });
  const focusField = (field: string) => {
    if (field === "generation") {
      onConfigureGeneration?.();
      return;
    }
    if (field.startsWith("prompts.")) {
      const stage = field.slice(8);
      setExpanded((values) =>
        values.includes(stage) ? values : [...values, stage],
      );
      requestAnimationFrame(() => form.getInputNode(field)?.focus());
    } else form.getInputNode(field)?.focus();
  };
  const failValidation = (errors: Record<string, unknown>) => {
    setSummary({
      ...Object.fromEntries(
        Object.entries(errors).map(([key, value]) => [key, String(value)]),
      ),
      ...(!generation?.id
        ? { generation: "이미지 생성 모델을 먼저 저장하세요." }
        : {}),
    });
    focusSummary();
  };
  return (
    <form
      className={classes.naturalForm}
      onSubmit={form.onSubmit((values) => {
        if (modelsPending || modelsError) {
          setSummary({ models: "모델 목록을 다시 불러온 뒤 저장하세요." });
          return;
        }
        if (!generation?.id) {
          failValidation({});
          return;
        }
        setSummary({});
        save.mutate(values);
      }, failValidation)}
    >
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={2}>자연스러운 사진 Agent</Title>
            <Text size="sm" c="ink.6">
              기획 → 생성 → 사진 검수 → 캡션 → 게시. 검수 불합격은 보류합니다.
            </Text>
          </Stack>
          <Badge color={current ? "teal" : "attention"} variant="light">
            {current ? "설정 저장됨" : "초기 설정 필요"}
          </Badge>
        </Group>
        {Object.keys(summary).length ? (
          <Alert
            color="red"
            role="alert"
            title="저장 전에 확인해 주세요"
            ref={summaryRef}
            tabIndex={-1}
          >
            <Stack gap="xs">
              {Object.entries(summary).map(([field, message]) => (
                <Button
                  key={field}
                  variant="default"
                  justify="flex-start"
                  className={classes.summaryAction}
                  classNames={{ label: classes.summaryLabel }}
                  onClick={() =>
                    field === "models" ? onRetryModels?.() : focusField(field)
                  }
                >
                  {message}
                </Button>
              ))}
            </Stack>
          </Alert>
        ) : null}
        <Paper withBorder p="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={3}>실행 모델</Title>
              <Button variant="default" onClick={onManageModels}>
                모델 목록 관리
              </Button>
            </Group>
            {modelsPending ? (
              <Text role="status">모델 목록을 불러오는 중…</Text>
            ) : null}
            {modelsError ? (
              <Alert color="red" title="모델 목록 조회 실패">
                <Text size="sm">모델 설정을 확인할 수 없습니다.</Text>
                <Button variant="default" onClick={onRetryModels}>
                  모델 목록 다시 불러오기
                </Button>
              </Alert>
            ) : null}
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
              <Select
                label="기획·캡션 모델"
                withAsterisk
                placeholder="기획·캡션 모델 선택"
                description="레퍼런스와 사진 입력을 지원하는 LLM"
                data={options}
                searchable
                classNames={{ description: classes.fieldDescription }}
                disabled={modelsPending || !!modelsError || save.isPending}
                key={form.key("planningAiModelId")}
                {...form.getInputProps("planningAiModelId")}
              />
              <Select
                label="사진 검수 모델"
                withAsterisk
                placeholder="사진 검수 모델 선택"
                description="사진 입력을 지원하는 LLM"
                data={options}
                searchable
                classNames={{ description: classes.fieldDescription }}
                disabled={modelsPending || !!modelsError || save.isPending}
                key={form.key("reviewAiModelId")}
                {...form.getInputProps("reviewAiModelId")}
              />
              <Stack gap="xs" className={classes.modelSummary}>
                <Text component="div" fw={500} size="sm">
                  이미지 생성 모델{" "}
                  <Badge size="sm" variant="outline" color="ink" c="ink.7">
                    공통
                  </Badge>
                </Text>
                <Text size="xs" c="ink.6">
                  기존·새 Agent가 함께 사용하는 설정
                </Text>
                <Text size="sm" className={classes.code}>
                  {generation?.id
                    ? `${generation.provider} / ${generation.effectiveModel}`
                    : "이미지 생성 모델을 먼저 저장하세요."}
                </Text>
                {generation?.id ? (
                  <Text size="xs" c="ink.6">
                    저장된 버전 {generation.revision} · 새 Agent 저장 시 함께
                    고정
                  </Text>
                ) : null}
                {current?.generation &&
                (current.generation.provider !== generation?.provider ||
                  current.generation.effectiveModel !==
                    generation?.effectiveModel) ? (
                  <Text size="xs" className={classes.code}>
                    현재 새 Agent에 고정: {current.generation.provider} /{" "}
                    {current.generation.effectiveModel}
                  </Text>
                ) : null}
                <Button variant="default" onClick={onConfigureGeneration}>
                  {generation?.id
                    ? "이미지 생성 모델 변경"
                    : "이미지 생성 모델 설정"}
                </Button>
              </Stack>
            </SimpleGrid>
          </Stack>
        </Paper>
        <Stack gap="sm">
          <Title order={3}>단계별 지침</Title>
          <Text size="sm" c="ink.6">
            {current
              ? "필요한 단계만 펼쳐 수정하세요. 저장한 설정은 신규 작업부터 적용됩니다."
              : "기본 초안을 검토한 뒤 저장하세요. 저장 전에는 새 Agent가 실행되지 않습니다."}
          </Text>
          <Accordion
            multiple
            value={expanded}
            onChange={setExpanded}
            variant="separated"
          >
            {(Object.keys(labels) as NaturalStage[]).map((stage, index) => (
              <Accordion.Item value={stage} key={stage}>
                <Accordion.Control>
                  {index + 1}. {labels[stage]}
                </Accordion.Control>
                <Accordion.Panel>
                  <Textarea
                    label={`${labels[stage]} 지침`}
                    minRows={6}
                    autosize
                    maxRows={16}
                    maxLength={50000}
                    disabled={save.isPending}
                    key={form.key(`prompts.${stage}`)}
                    {...form.getInputProps(`prompts.${stage}`)}
                  />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Stack>
        <Checkbox
          label="예약 자동 생성에도 새 Agent 사용"
          description="기본은 기존 Agent입니다. 저장 후 새로 만드는 예약 작업에 적용합니다."
          disabled={save.isPending}
          classNames={{ description: classes.fieldDescription }}
          key={form.key("schedulerDefault")}
          {...form.getInputProps("schedulerDefault", { type: "checkbox" })}
        />
        {save.error ? (
          <OperationErrorAlert
            failure={{
              ...operationFailure(
                save.error,
                "새 Agent 설정을 저장하지 못했습니다.",
              ),
              nextAction:
                "입력은 유지됩니다. 누락된 모델을 설정하거나 최신 저장값을 확인한 뒤 다시 저장하세요.",
            }}
          />
        ) : null}
        {save.error ? (
          <Button
            variant="default"
            loading={reload.isPending}
            onClick={() => reload.mutate()}
          >
            최신 설정 확인 · 입력 유지
          </Button>
        ) : null}
        {reload.error ? (
          <OperationErrorAlert
            failure={operationFailure(
              reload.error,
              "최신 설정을 불러오지 못했습니다.",
            )}
          />
        ) : null}
        {latest ? (
          <Alert color="attention">
            최신 저장 버전을 확인했습니다. 입력은 유지했습니다. 비교 후
            저장하세요.
            <Accordion>
              <Accordion.Item value="latest">
                <Accordion.Control>최신 지침 비교</Accordion.Control>
                <Accordion.Panel>
                  {(Object.keys(labels) as NaturalStage[]).map((stage) => (
                    <Stack key={stage} gap={4} mb="md">
                      <Text fw={500}>{labels[stage]}</Text>
                      <Text size="sm" className={classes.code}>
                        {latest.prompts[stage]}
                      </Text>
                    </Stack>
                  ))}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Alert>
        ) : null}
        <Group className={classes.saveBar}>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={modelsPending || !!modelsError}
          >
            새 Agent 설정 저장
          </Button>
          <Text size="sm" c="ink.6">
            신규 작업에 적용 · 진행 중 작업은 저장된 버전 유지
          </Text>
        </Group>
      </Stack>
    </form>
  );
}
