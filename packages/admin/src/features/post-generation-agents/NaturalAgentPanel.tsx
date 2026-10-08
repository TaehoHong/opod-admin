import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
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
  type AiModel,
  type NaturalConfig,
  type NaturalStage,
} from "./api";

const labels: Record<NaturalStage, string> = {
  post_plan: "게시물 기획",
  image_plan: "이미지 기획 · 레퍼런스 검토",
  image_prompt: "이미지 프롬프트",
  caption: "캡션",
  naturalness: "사진 자연스러움 검수",
  requirements: "정체성·요구사항 검수",
};
export function NaturalAgentPanel({
  models,
  onDirtyChange,
}: {
  models: AiModel[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const config = useQuery({
    queryKey: ["natural-post-agent"],
    queryFn: fetchNaturalAgent,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  return (
    <Accordion variant="contained">
      <Accordion.Item value="natural">
        <Accordion.Control>
          새 Agent · 자연스러운 사진 자동 제작
        </Accordion.Control>
        <Accordion.Panel>
          {config.error ? (
            <OperationErrorAlert
              failure={operationFailure(
                config.error,
                "새 Agent 설정을 불러오지 못했습니다.",
              )}
            />
          ) : null}
          {config.data ? (
            <NaturalEditor
              key={config.data.current?.revision ?? "unconfigured"}
              current={config.data.current}
              starters={config.data.starters}
              models={models}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            <Text>설정을 불러오는 중입니다.</Text>
          )}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
function NaturalEditor({
  current,
  starters,
  models,
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  current: NaturalConfig | null;
  starters: Record<NaturalStage, string>;
  models: AiModel[];
}) {
  const queryClient = useQueryClient();
  const [expectedRevision, setExpectedRevision] = useState(
    current?.revision ?? null,
  );
  const [latest, setLatest] = useState<NaturalConfig | null>(null);
  const reload = useMutation({
    mutationFn: fetchNaturalAgent,
    onSuccess: (value) => {
      setLatest(value.current);
      setExpectedRevision(value.current?.revision ?? null);
    },
  });
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
      /* Use saved settings when browser draft storage is unavailable. */
    }
    return { values: clean, expectedRevision: current?.revision ?? null };
  });
  useEffect(() => {
    setExpectedRevision(initial.expectedRevision ?? null);
    onDirtyChange?.(JSON.stringify(initial.values) !== JSON.stringify(clean));
  }, []);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: initial.values!,
    onValuesChange: (values) => {
      onDirtyChange?.(JSON.stringify(values) !== JSON.stringify(clean));
      try {
        sessionStorage.setItem(
          "natural-agent-edit",
          JSON.stringify({ values, expectedRevision }),
        );
      } catch {
        /* Keep input in the mounted form. */
      }
    },
    validate: {
      planningAiModelId: (value) => (value ? null : "기획 모델을 선택하세요"),
      reviewAiModelId: (value) =>
        value ? null : "이미지를 읽을 수 있는 검수 모델을 선택하세요",
    },
  });
  useBeforeUnload((event) => {
    if (form.isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      saveNaturalAgent({
        ...values,
        expectedRevision,
      }),
    onSuccess: () => {
      form.resetDirty();
      onDirtyChange?.(false);
      try {
        sessionStorage.removeItem("natural-agent-edit");
      } catch {
        /* Saved settings remain available. */
      }
      void queryClient.invalidateQueries({ queryKey: ["natural-post-agent"] });
    },
  });
  const options = models
    .filter((model) => model.type === "llm")
    .map((model) => ({ value: model.id, label: model.model }));
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack>
        <Alert color={current ? "teal" : "amber"}>
          {current
            ? "저장된 새 Agent 설정이 있습니다. 신규 작업은 이 버전을 복사해 실행합니다."
            : "아직 미설정입니다. 아래 초안 지침을 검토하고 저장해야 새 Agent를 실행할 수 있습니다."}{" "}
          이미지 생성 모델은 기존 이미지 생성 단계에 저장된 버전을 함께
          고정합니다.
        </Alert>
        <Text size="sm">
          기획 → 이미지 생성 → 사진 검수 → 캡션 → 자동 게시로 진행합니다. 검수
          불합격은 보류합니다. 기존 Agent의 지침은 독립적으로 유지합니다.
        </Text>
        <Checkbox
          label="예약 자동 생성에도 새 Agent 사용"
          description="기본은 기존 Agent입니다. 저장 후 새로 생성하는 예약 작업부터 적용합니다."
          key={form.key("schedulerDefault")}
          {...form.getInputProps("schedulerDefault", { type: "checkbox" })}
        />
        <Select
          label="새 Agent 기획·캡션 모델"
          description="레퍼런스와 생성 사진의 이미지 입력을 지원하는 모델을 선택하세요."
          data={options}
          searchable
          key={form.key("planningAiModelId")}
          {...form.getInputProps("planningAiModelId")}
        />
        <Select
          label="사진 검수 모델"
          description="이미지 입력을 지원하는 모델을 선택하세요."
          data={options}
          searchable
          key={form.key("reviewAiModelId")}
          {...form.getInputProps("reviewAiModelId")}
        />
        <Accordion variant="separated">
          {(Object.keys(labels) as NaturalStage[]).map((stage) => (
            <Accordion.Item value={stage} key={stage}>
              <Accordion.Control>{labels[stage]}</Accordion.Control>
              <Accordion.Panel>
                <Textarea
                  label={`${labels[stage]} 지침`}
                  minRows={8}
                  autosize
                  maxRows={18}
                  maxLength={50000}
                  key={form.key(`prompts.${stage}`)}
                  {...form.getInputProps(`prompts.${stage}`)}
                />
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
        {save.error ? (
          <OperationErrorAlert
            failure={operationFailure(
              save.error,
              "새 Agent 설정을 저장하지 못했습니다. 입력은 유지됩니다.",
            )}
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
          <Alert color="amber">
            최신 저장 버전을 확인했습니다. 입력은 유지했습니다. 아래 최신 지침과
            비교한 후 저장하면 현재 입력이 적용됩니다.
            <details>
              <summary>최신 설정 보기</summary>
              <pre>{JSON.stringify(latest, null, 2)}</pre>
            </details>
          </Alert>
        ) : null}
        <Group>
          <Button type="submit" loading={save.isPending}>
            새 Agent 설정 저장
          </Button>
          {save.isSuccess ? <Text size="sm">저장했습니다.</Text> : null}
        </Group>
      </Stack>
    </form>
  );
}
