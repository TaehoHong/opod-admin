import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import {
  runEvaluationWorkerOnce,
  runWorkerOnce,
  updateGenerationSettings,
  type GenerationSettingsUpdate,
  type GenerationSettingsView,
  type SettingSource,
} from "./api";

export function WorkerCard({
  settings,
  queuedCount,
}: {
  settings: GenerationSettingsView;
  queuedCount: number;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["settings"] });

  // 토글은 저장 버튼 없이 바로 반영한다 — 워커를 급히 멈춰야 하는 상황에서
  // 저장을 한 번 더 누르게 만들 이유가 없다.
  const toggle = useMutation({
    mutationFn: (body: GenerationSettingsUpdate) =>
      updateGenerationSettings(body),
    onSuccess: invalidate,
  });
  const run = useMutation({ mutationFn: runWorkerOnce, onSuccess: invalidate });
  const runEvaluation = useMutation({
    mutationFn: runEvaluationWorkerOnce,
    onSuccess: invalidate,
  });

  const { worker, resolved } = settings;
  const spend = worker.todaySpendUsd.toFixed(2);
  const budget =
    worker.dailyBudgetUsd === null
      ? `$${spend} (예산 미설정)`
      : `$${spend} / $${worker.dailyBudgetUsd.toFixed(2)}`;

  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Title order={6}>생성 워커</Title>
        <Stack gap={6}>
          <Row label="자동 루프">
            <LoopSwitch
              label="생성 워커 자동 루프"
              enabled={worker.enabled}
              source={worker.enabledSource}
              pending={
                toggle.isPending &&
                toggle.variables?.workerEnabled !== undefined
              }
              onChange={(workerEnabled) => toggle.mutate({ workerEnabled })}
            />
          </Row>
          <Row label="t2i">{resolved.t2iProvider ?? "—"}</Row>
          <Row label="edit">{resolved.editProvider ?? "—"}</Row>
          <Row label="기획 LLM">{resolved.plannerProvider}</Row>
          <Row label="오늘 지출">
            {budget}
            <Text span size="xs" c="dimmed">
              {" "}
              (잡당 추정 ${worker.jobCostEstimateUsd.toFixed(2)})
            </Text>
          </Row>
        </Stack>

        <Text size="xs" c="dimmed">
          자동 루프는 초안 기획·게시와 이미지 생성을 함께 제어합니다. 수동
          실행은 루프가 꺼져 있어도 동작하며, 대기 중인 다음 작업 하나를 즉시
          처리합니다.
        </Text>

        {run.isError ? (
          <Alert color="red" role="alert" title="실행하지 못했습니다">
            {run.error.message}
          </Alert>
        ) : null}
        {run.isSuccess ? (
          <Alert color={run.data.jobId ? "teal" : "ink"} role="status">
            {run.data.jobId
              ? "작업 실행을 시작했습니다."
              : "대기 중인 작업이 없습니다."}
          </Alert>
        ) : null}

        <Group>
          <Button
            variant="default"
            loading={run.isPending}
            onClick={() => run.mutate()}
          >
            대기 작업 실행
            {queuedCount > 0 ? ` (${queuedCount}건 대기)` : ""}
          </Button>
        </Group>

        <Divider />
        <Title order={6}>평가 워커</Title>
        <Row label="자동 루프">
          <LoopSwitch
            label="평가 워커 자동 루프"
            enabled={worker.evaluation.enabled}
            source={worker.evaluation.enabledSource}
            pending={
              toggle.isPending &&
              toggle.variables?.evaluationWorkerEnabled !== undefined
            }
            onChange={(evaluationWorkerEnabled) =>
              toggle.mutate({ evaluationWorkerEnabled })
            }
          />
        </Row>

        <Text size="xs" c="dimmed">
          평가는 기획·프롬프트 품질 신호만 남기고 게시 파이프라인을 막지
          않습니다. 꺼두면 평가 결과가 쌓이지 않을 뿐 이미지 생성은 그대로
          진행됩니다.
        </Text>

        {runEvaluation.isError ? (
          <Alert color="red" role="alert" title="실행하지 못했습니다">
            {runEvaluation.error.message}
          </Alert>
        ) : null}
        {runEvaluation.isSuccess ? (
          <Alert
            color={runEvaluation.data.evaluated.length > 0 ? "teal" : "ink"}
            role="status"
          >
            {evaluationRunMessage(runEvaluation.data.evaluated)}
          </Alert>
        ) : null}

        <Group>
          <Button
            variant="default"
            loading={runEvaluation.isPending}
            onClick={() => runEvaluation.mutate()}
          >
            대기 평가 실행
          </Button>
        </Group>

        <MutationAlert
          mutation={toggle}
          success="워커 설정을 저장했습니다."
          errorTitle="저장하지 못했습니다"
        />
      </Stack>
    </Paper>
  );
}

// 실행 결과는 "무엇이 돌았는지"를 그대로 말한다 — 대기 건이 없었던 것과
// 실행한 것을 운영자가 구분해야 한다.
function evaluationRunMessage(
  evaluated: ("plan" | "prompt" | "image")[],
): string {
  if (evaluated.length === 0) {
    return "대기 중인 평가가 없습니다.";
  }
  const names = evaluated.map((kind) =>
    kind === "plan" ? "기획" : kind === "prompt" ? "프롬프트" : "이미지",
  );
  return `${names.join("·")} 평가를 실행했습니다.`;
}

function LoopSwitch({
  label,
  enabled,
  source,
  pending,
  onChange,
}: {
  label: string;
  enabled: boolean;
  source: SettingSource;
  pending: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <Group gap="xs" align="center" wrap="nowrap">
      <Switch
        aria-label={label}
        checked={enabled}
        disabled={pending}
        onChange={(event) => onChange(event.currentTarget.checked)}
        label={enabled ? "켜짐" : "꺼짐"}
      />
      {/* DB에 값이 없어 env 기본값을 쓰는 중이라는 뜻. 한 번 저장하면 사라진다. */}
      {source === "env" ? (
        <Badge color="ink" variant="light">
          env 기본값
        </Badge>
      ) : null}
    </Group>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Group gap="sm" align="baseline" wrap="nowrap">
      <Text
        size="xs"
        c="dimmed"
        tt="uppercase"
        w={90}
        style={{ flexShrink: 0 }}
      >
        {label}
      </Text>
      {/* 값 자리에 Switch·Badge 같은 블록 요소가 들어오므로 p로 감싸지 않는다. */}
      <Text component="div" size="sm" style={{ wordBreak: "break-all" }}>
        {children}
      </Text>
    </Group>
  );
}
