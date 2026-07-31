import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { runWorkerOnce, type GenerationSettingsView } from "./api";

export function WorkerCard({
  settings,
  queuedCount,
}: {
  settings: GenerationSettingsView;
  queuedCount: number;
}) {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: runWorkerOnce,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
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
            {worker.enabled ? (
              <Badge color="teal">켜짐</Badge>
            ) : (
              <Badge color="ink" variant="light">
                꺼짐 (WORKER_ENABLED)
              </Badge>
            )}
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
          수동 실행은 자동 루프가 꺼져 있어도 동작하며, 대기 중인 다음 작업
          하나를 즉시 처리합니다.
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
      </Stack>
    </Paper>
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
      <Text size="sm" style={{ wordBreak: "break-all" }}>
        {children}
      </Text>
    </Group>
  );
}
