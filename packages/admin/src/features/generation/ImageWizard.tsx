import {
  Alert,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  Spoiler,
  Stack,
  Stepper,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { JobCandidateGrid } from "./JobCandidateGrid";
import {
  confirmImageDraft,
  fetchGenerationJob,
  fetchJobHistory,
  regenerateJob,
  selectJobOutput,
  updateImageDraft,
  wizardStep,
  wizardStepIndex,
  WIZARD_STEPS,
  type GenerationJob,
} from "./api";
import { useState } from "react";

// 생성 중에는 서버가 상태를 바꾸므로 짧게 폴링한다. 종료 상태에서는 멈춘다.
const POLL_INTERVAL_MS = 2000;

function jobKey(jobId: string) {
  return ["generation", "job", jobId] as const;
}

export function ImageWizard({
  jobId,
  onJobChange,
}: {
  jobId: string;
  onJobChange: (jobId: string) => void;
}) {
  const job = useQuery({
    queryKey: jobKey(jobId),
    queryFn: () => fetchGenerationJob(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running"
        ? POLL_INTERVAL_MS
        : false;
    },
  });

  if (job.isPending) return <Loader aria-label="생성 작업 불러오는 중" />;
  if (job.error) {
    return (
      <Alert color="red" role="alert" title="불러오지 못했습니다">
        {job.error.message}
      </Alert>
    );
  }

  // 잡이 바뀌면(새 회차) 폼과 후보 선택을 이어받으면 안 된다. uncontrolled
  // form은 mount 시점의 initialValues만 쓰므로 key로 새로 시작시킨다.
  return (
    <WizardBody key={job.data.id} job={job.data} onJobChange={onJobChange} />
  );
}

function WizardBody({
  job,
  onJobChange,
}: {
  job: GenerationJob;
  onJobChange: (jobId: string) => void;
}) {
  const step = wizardStep(job);
  const history = useQuery({
    queryKey: ["generation", "history", job.originJobId ?? ""],
    queryFn: () => fetchJobHistory(job.originJobId),
    enabled: Boolean(job.originJobId),
  });

  return (
    <Stack gap="md">
      <Stepper
        active={wizardStepIndex(job)}
        size="sm"
        allowNextStepsSelect={false}
      >
        {WIZARD_STEPS.map((label) => (
          <Stepper.Step key={label} label={label} />
        ))}
      </Stepper>

      {step === "prompt" ? (
        <PromptStep job={job} />
      ) : step === "generating" ? (
        <GeneratingStep job={job} />
      ) : step === "failed" ? (
        <FailedStep job={job} onJobChange={onJobChange} />
      ) : (
        <SelectStep job={job} onJobChange={onJobChange} />
      )}

      {history.data?.length ? (
        <Spoiler
          maxHeight={0}
          showLabel={`이전 생성 회차 (${history.data.length})`}
          hideLabel="접기"
        >
          <Stack gap="sm" pt="sm">
            {history.data.map((round, index) => (
              <Paper key={round.id} p="md">
                <Stack gap="xs">
                  <Text fw={600}>
                    {index + 1}회차 · {round.status}
                  </Text>
                  <Text size="sm">{round.prompt || "—"}</Text>
                  <Text size="xs" c="dimmed">
                    후보 {round.candidateCount ?? round.outputs?.length ?? "—"}{" "}
                    · 비용 {round.costUsd ? `$${round.costUsd}` : "—"}
                    {round.errorMessage ? ` · ${round.errorMessage}` : ""}
                  </Text>
                  <JobCandidateGrid
                    outputs={round.outputs ?? []}
                    selectedMediaId={round.outputMediaId}
                  />
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Spoiler>
      ) : null}
    </Stack>
  );
}

// ② 프롬프트 확인 — 저장과 확정을 나눠 둔다. 확정해야 비용이 발생한다.
function PromptStep({ job }: { job: GenerationJob }) {
  const queryClient = useQueryClient();
  const context = job.generationContext;

  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      prompt: job.prompt,
      candidateCount: job.candidateCount ?? 1,
    },
    validate: {
      prompt: (value) =>
        value.trim().length === 0 ? "최종 프롬프트를 입력해 주세요" : null,
    },
  });

  const write = (updated: GenerationJob) => {
    queryClient.setQueryData(jobKey(job.id), updated);
    void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
  };

  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      updateImageDraft(job.id, {
        prompt: values.prompt.trim(),
        candidateCount: values.candidateCount,
      }),
    onSuccess: write,
  });

  // 확정은 저장 후에 이어서 한다 — 화면의 값과 실제 실행 값이 어긋나지 않게.
  const confirm = useMutation({
    mutationFn: async (values: typeof form.values) => {
      await updateImageDraft(job.id, {
        prompt: values.prompt.trim(),
        candidateCount: values.candidateCount,
      });
      return confirmImageDraft(job.id);
    },
    onSuccess: (updated) => {
      write(updated);
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
    },
  });

  const error = save.error ?? confirm.error;

  // 같은 폼에 저장과 확정 두 갈래가 있다. 검증을 먼저 돌리고 통과한 값으로
  // 해당 mutation만 실행한다.
  const submit = (action: "save" | "confirm") => {
    if (form.validate().hasErrors) return;
    const values = form.getValues();
    if (action === "save") save.mutate(values);
    else confirm.mutate(values);
  };

  return (
    <Paper p="md" component="section">
      <div>
        <Stack gap="sm">
          <Title order={5}>최종 프롬프트 확인</Title>

          <Textarea
            label="원본 요청"
            readOnly
            autosize
            minRows={2}
            value={job.inputPrompt || job.prompt}
          />
          {job.expandedScene ? (
            <Textarea
              label={`LLM 확장 장면 (${job.plannerName ?? "planner"})`}
              readOnly
              autosize
              minRows={2}
              value={job.expandedScene}
            />
          ) : null}
          <Textarea
            label="최종 프롬프트"
            autosize
            minRows={6}
            key={form.key("prompt")}
            {...form.getInputProps("prompt")}
          />
          <NumberInput
            label="후보 수"
            min={1}
            max={4}
            w={150}
            key={form.key("candidateCount")}
            {...form.getInputProps("candidateCount")}
          />

          <Text size="xs" c="dimmed">
            장면 확장: {job.plannerName ?? "LLM 미설정 — 원문 사용"} · negative
            prompt: {context?.negativePrompt || "없음"} · 레퍼런스{" "}
            {context?.referenceImageCount ?? 0}장 · 비율{" "}
            {job.aspectRatio ?? "프로필 기본"} · {context?.route ?? "t2i"}
          </Text>
          <Text size="xs" c="dimmed">
            확정 전에는 비용이 발생하지 않습니다.
          </Text>

          {error ? (
            <Alert color="red" role="alert" title="처리하지 못했습니다">
              {error.message}
            </Alert>
          ) : null}

          <Group>
            <Button
              variant="default"
              loading={save.isPending}
              onClick={() => submit("save")}
            >
              프롬프트 저장
            </Button>
            <Button
              loading={confirm.isPending}
              onClick={() => submit("confirm")}
            >
              이미지 생성
            </Button>
          </Group>
        </Stack>
      </div>
    </Paper>
  );
}

function GeneratingStep({ job }: { job: GenerationJob }) {
  return (
    <Paper p="md" component="section">
      <Stack gap="xs">
        <Title order={5}>
          {job.status === "queued" ? "생성 대기" : "생성 중"}
        </Title>
        <Text size="sm">
          {job.status === "queued"
            ? "작업이 실행 순서를 기다리고 있습니다."
            : "이미지 후보를 생성하고 있습니다."}
        </Text>
        <Text size="xs" c="dimmed">
          {job.provider ?? "프로바이더 준비 중"}
        </Text>
      </Stack>
    </Paper>
  );
}

function FailedStep({
  job,
  onJobChange,
}: {
  job: GenerationJob;
  onJobChange: (jobId: string) => void;
}) {
  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Title order={5}>생성 실패</Title>
        <Alert color="red">
          {job.errorMessage ?? "이미지 생성에 실패했습니다."}
        </Alert>
        <RegenerateButton job={job} onJobChange={onJobChange} />
      </Stack>
    </Paper>
  );
}

// ④ 후보 선택 / 확정 완료.
function SelectStep({
  job,
  onJobChange,
}: {
  job: GenerationJob;
  onJobChange: (jobId: string) => void;
}) {
  const queryClient = useQueryClient();
  const confirmed = Boolean(job.outputMediaId);
  const [picked, setPicked] = useState<string | undefined>(job.outputMediaId);

  const select = useMutation({
    mutationFn: (mediaId: string) => selectJobOutput(job.id, mediaId),
    onSuccess: (updated) => {
      queryClient.setQueryData(jobKey(job.id), updated);
      void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
    },
  });

  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Title order={5}>{confirmed ? "확정 완료" : "후보 선택"}</Title>
        <JobCandidateGrid
          outputs={job.outputs ?? []}
          selectedMediaId={confirmed ? job.outputMediaId : picked}
          {...(confirmed ? {} : { onSelect: setPicked })}
        />
        {select.isError ? (
          <Alert color="red" role="alert" title="확정하지 못했습니다">
            {select.error.message}
          </Alert>
        ) : null}
        <Group>
          {confirmed ? (
            <RegenerateButton job={job} onJobChange={onJobChange} />
          ) : (
            <Button
              disabled={!picked}
              loading={select.isPending}
              onClick={() => picked && select.mutate(picked)}
            >
              최종 확정
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

// 새 회차는 새 잡을 만든다. 화면이 그 잡으로 옮겨가야 이어서 진행할 수 있다.
function RegenerateButton({
  job,
  onJobChange,
}: {
  job: GenerationJob;
  onJobChange: (jobId: string) => void;
}) {
  const queryClient = useQueryClient();
  const regenerate = useMutation({
    mutationFn: () => regenerateJob(job.id),
    onSuccess: (next) => {
      queryClient.setQueryData(jobKey(next.id), next);
      void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
      onJobChange(next.id);
    },
  });

  return (
    <Stack gap={4}>
      <Button
        variant="default"
        loading={regenerate.isPending}
        onClick={() => regenerate.mutate()}
      >
        프롬프트 수정 후 새 회차
      </Button>
      {regenerate.isError ? (
        <Text size="xs" c="red" role="alert">
          {regenerate.error.message}
        </Text>
      ) : null}
    </Stack>
  );
}
