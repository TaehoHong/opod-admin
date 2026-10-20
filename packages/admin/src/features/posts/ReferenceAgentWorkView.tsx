import {
  Modal,
  Alert,
  Badge,
  Button,
  CopyButton,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { CharacterName } from "../../shared/ui/EntityName";
import { DataPage } from "../../shared/ui/DataPage";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import {
  updateDraft,
  restartReferenceDraft,
  fetchDraft,
  runDraftStage,
  type Draft,
} from "../drafts/api";
import { retryJob, runWorker } from "../generation/api";
import { SHOT_STATUS_LABEL, SHOT_STATUS_COLOR } from "../drafts/labels";
import { useDraftMutation } from "../drafts/useDraftMutation";
import { StageExecutionRecords } from "../llm-logs/StageExecutionRecords";
import type { PostWorkItem } from "./api";
import {
  fetchReferenceSource,
  fetchReferenceIdentity,
  record,
  referenceView,
  REFERENCE_STAGES,
  rows,
  text,
} from "./reference-agent-view";
import styles from "./ReferenceAgentWorkView.module.css";

export function ReferenceAgentWorkView({
  item,
  draft,
  stage,
  automation,
}: {
  item: PostWorkItem;
  draft: Draft;
  stage?: string;
  automation?: ReactNode;
}) {
  const view = referenceView(draft);
  const navigate = useNavigate();
  const [scheduledAt, setScheduledAt] = useState<string>();
  const [restartTarget, setRestartTarget] = useState<
    "reference_select" | "generation"
  >();
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [caption, setCaption] = useState<string>();
  const [hashtags, setHashtags] = useState<string>();
  const [preview, setPreview] = useState(false);
  const active = REFERENCE_STAGES.find((s) => s.id === stage);
  const current =
    REFERENCE_STAGES.find((s) => s.id === item.currentStage)?.id ??
    "reference_select";
  const pipeline = record(draft.conceptJson?.pipeline);
  const terminal = ["needs_review", "approved", "published"].includes(
    draft.status,
  );
  const execute = useDraftMutation(draft.id, () =>
    runDraftStage(draft.id, "plan", {
      expectedStage: current,
      expectedRevision: draft.updatedAt,
    }),
  );
  const publish = useDraftMutation(draft.id, async () => {
    const approved =
      draft.status === "needs_review"
        ? await runDraftStage(draft.id, "approve")
        : await fetchDraft(draft.id);
    return draft.scheduledAt ? approved : runDraftStage(draft.id, "publish");
  });
  const schedule = useDraftMutation(draft.id, () =>
    updateDraft(draft.id, {
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    }),
  );
  const retry = useDraftMutation<string>(draft.id, async (jobId) => {
    await retryJob(jobId);
    return fetchDraft(draft.id);
  });
  const runQueued = useDraftMutation<string>(draft.id, async (jobId) => {
    await runWorker(jobId);
    return fetchDraft(draft.id);
  });
  const restart = useDraftMutation<"reference_select" | "generation">(
    draft.id,
    (target) =>
      restartReferenceDraft(draft.id, {
        target,
        expectedRevision: draft.updatedAt,
      }),
  );
  const aggregate = useDraftMutation(draft.id, () =>
    runDraftStage(draft.id, "aggregate"),
  );
  const mutationsPending =
    execute.isPending ||
    publish.isPending ||
    schedule.isPending ||
    retry.isPending ||
    restart.isPending ||
    aggregate.isPending ||
    runQueued.isPending;
  const activeWork =
    pipeline.state === "running" ||
    draft.status === "generating" ||
    draft.status === "regenerating" ||
    draft.shots?.some((shot) =>
      ["queued", "running", "processing"].includes(shot.status),
    );
  const restartDisabled =
    mutationsPending ||
    activeWork ||
    ["published", "rejected"].includes(draft.status);
  const generationJobIds = record(draft.conceptJson).generationBuild;
  const currentJobIds = record(generationJobIds).jobIds;
  const currentJobs = Array.isArray(currentJobIds)
    ? draft.shots?.filter((shot) => currentJobIds.includes(shot.jobId))
    : draft.shots;
  const completedGeneration =
    !!currentJobs?.length &&
    currentJobs.every((shot) => shot.status === "completed") &&
    (!Array.isArray(currentJobIds) ||
      currentJobs.length === currentJobIds.length);
  const shot =
    view.shots.find((s) => s.shotId === selected[stage ?? current]) ??
    view.shots[0];
  const source = useQuery({
    queryKey: ["reference-source", shot?.mediaId, shot?.sha256],
    queryFn: () => fetchReferenceSource(shot!),
    enabled: !!shot,
  });
  const save = useDraftMutation(draft.id, () =>
    updateDraft(draft.id, {
      caption: (caption ?? draft.caption).trim(),
      hashtags: (hashtags ?? draft.hashtags.join(", "))
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    }),
  );
  if (!active)
    return (
      <Navigate
        to={`/posts/${encodeURIComponent(item.id)}/${current}`}
        replace
      />
    );

  const job = currentJobs?.find((s) => s.sortOrder === shot?.sortOrder);
  const result = job?.outputs.find((o) => o.selected) ?? job?.outputs[0];
  const promptShot = rows(record(view.prompt.output).shots).find(
    (s) => s.shotId === shot?.shotId,
  );
  const prompt = {
    prompt: text(promptShot?.prompt),
    negativePrompt: text(promptShot?.negativePrompt),
  };
  const artifact =
    stage === "reference_select"
      ? view.selection
      : stage === "image_prompt"
        ? view.prompt
        : stage === "caption"
          ? view.caption
          : undefined;
  const identity =
    stage === "reference_select"
      ? rows(shot?.visualReferences)
      : rows(
          rows(record(view.prompt.input).shots).find(
            (s) => s.shotId === shot?.shotId,
          )?.references,
        ).filter((r) => r.role === "character_identity");
  const editableCaption = ["needs_review", "approved"].includes(draft.status);
  const currentIndex = REFERENCE_STAGES.findIndex((s) => s.id === current);
  const currentLabel = REFERENCE_STAGES[currentIndex].label;
  const generationReady = current === "generation" && completedGeneration;
  const failed =
    !generationReady &&
    (draft.status === "failed" ||
      pipeline.state === "failed" ||
      item.operationalStatus === "failed");
  const blocked =
    !generationReady &&
    ["needs_input", "needs_configuration"].includes(text(pipeline.state));
  const working = !generationReady && !failed && !blocked && activeWork;
  const failureDetail =
    draft.errorMessage ||
    currentJobs?.find((s) => s.status === "failed")?.errorMessage ||
    text(record(pipeline.failure).message) ||
    (current === "image_prompt"
      ? text(record(view.prompt.output).blockedReason)
      : "");
  const statusLabel =
    draft.status === "published"
      ? "게시 완료"
      : failed
        ? `${currentLabel} 실패`
        : blocked
          ? `${currentLabel} 확인 필요`
          : generationReady
            ? "이미지 생성 완료"
            : terminal
              ? "게시 준비 완료"
              : working
                ? `${currentLabel} 진행 중`
                : `${currentLabel} 실행 대기`;
  const statusColor = failed
    ? "red"
    : blocked
      ? "attention"
      : generationReady || terminal
        ? "teal"
        : working
          ? "accent"
          : "ink";
  const nextAction =
    draft.status === "published"
      ? "게시된 사진과 캡션을 확인할 수 있습니다."
      : generationReady
        ? "사진을 검토한 뒤 ‘캡션 단계로 계속’을 눌러 다음 단계를 준비하세요."
        : terminal
          ? "사진과 캡션을 검토한 뒤 게시하거나 일정을 예약하세요."
          : working
            ? "작업이 끝나면 결과를 자동으로 갱신합니다."
            : `${currentLabel} 결과를 확인하고 현재 단계의 실행 버튼으로 진행하세요.`;
  const stageComplete = [
    view.shots.length > 0,
    rows(record(view.prompt.output).shots).length > 0,
    completedGeneration,
    !!text(record(view.caption.output).caption) ||
      (terminal && !!draft.caption.trim()),
  ];
  const previewAvailable =
    !!(caption ?? draft.caption).trim() ||
    !!draft.shots?.some((s) => s.outputs.length > 0);
  const image = (
    url: string | undefined | null,
    label: string,
    empty: string,
    compact = false,
  ) => (
    <div className={styles.image}>
      <Text size="sm" fw={600}>
        {label}
      </Text>
      {url ? (
        <ZoomableImage
          src={url}
          alt={label}
          fit="contain"
          className={compact ? styles.referencePhoto : styles.photo}
        />
      ) : (
        <Text
          size="sm"
          c="ink.6"
          className={`${styles.placeholder} ${compact ? styles.referencePhoto : styles.photo}`}
        >
          {empty}
        </Text>
      )}
    </div>
  );
  return (
    <DataPage
      title="게시물 제작"
      compact
      isPending={false}
      actions={
        <Button component={Link} to="/posts" variant="default">
          목록으로
        </Button>
      }
    >
      <Stack gap="sm">
        <div className={styles.summary}>
          <Group justify="space-between" gap="sm">
            <Group gap="xs">
              <CharacterName id={item.characterId} fw={700} />
              <Badge variant="light" color="ink">
                레퍼런스 Agent
              </Badge>
              <Badge variant="light" color="ink">
                {item.executionMode === "manual" ? "수동 진행" : "자동 진행"}
              </Badge>
              <div
                role="status"
                aria-label="작업 상태"
                aria-live="polite"
                aria-atomic="true"
              >
                <Badge
                  variant="light"
                  color={statusColor}
                  c={`${statusColor}.9`}
                >
                  {statusLabel}
                </Badge>
              </div>
            </Group>
            {automation}
          </Group>
          {!failed && !blocked && (
            <Text size="sm" c="ink.6" mt="xs">
              {nextAction}
            </Text>
          )}
        </div>
        <nav className={styles.stages} aria-label="레퍼런스 Agent 단계">
          {REFERENCE_STAGES.map((s, i) => {
            const state =
              s.id === current && failed
                ? "failed"
                : s.id === current && blocked
                  ? "blocked"
                  : s.id === current && working
                    ? "running"
                    : stageComplete[i]
                      ? "completed"
                      : s.id === current
                        ? "ready"
                        : "pending";
            const label = {
              failed: "실패",
              blocked: "확인 필요",
              completed: "완료",
              running: "진행 중",
              ready: "실행 대기",
              pending: "미실행",
            }[state];
            return (
              <Link
                key={s.id}
                to={`/posts/${encodeURIComponent(item.id)}/${s.id}`}
                aria-current={s.id === stage ? "page" : undefined}
                data-state={state}
              >
                <span className={styles.stageNumber}>
                  {state === "completed" ? (
                    <Check size={16} aria-hidden />
                  ) : state === "failed" || state === "blocked" ? (
                    <WarningCircle size={18} aria-hidden />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={styles.stageLabel}>
                  <strong>{s.label}</strong>
                  <small>
                    {label}
                    {s.id === current ? " · 현재 작업" : ""}
                  </small>
                </span>
              </Link>
            );
          })}
        </nav>
        {(failed || blocked) && (
          <Alert
            color={failed ? "red" : "attention"}
            role="alert"
            title={`${currentLabel} ${failed ? "실패" : "확인 필요"}`}
            icon={<WarningCircle size={20} aria-hidden />}
          >
            <Text size="sm" className={styles.preserve}>
              {failureDetail ||
                "서버에 상세 오류가 저장되지 않았습니다. 실행 기록에서 요청과 응답을 확인해 주세요."}
            </Text>
            <Group gap="sm" mt="xs">
              <Text size="sm">
                {current === "generation"
                  ? "실패한 사진을 선택해 재시도하세요. 완료된 사진은 유지됩니다."
                  : "설정과 입력을 확인한 뒤 현재 단계를 다시 실행하세요."}
              </Text>
              <a
                className={styles.recordLink}
                href={
                  stage === current
                    ? "#reference-execution-records"
                    : `/posts/${encodeURIComponent(item.id)}/${current}#reference-execution-records`
                }
              >
                실행 기록 확인
              </a>
            </Group>
          </Alert>
        )}
        <Group justify="space-between">
          <Group gap="sm">
            <Title order={2} size="h3">
              {active.label}
            </Title>
            {view.shots.length === 1 && (
              <Text size="sm" c="ink.6">
                사진 1 / 1
              </Text>
            )}
          </Group>
          <Group gap="xs">
            {stage === "reference_select" && view.shots.length > 0 && (
              <Button
                variant="default"
                size="xs"
                disabled={restartDisabled}
                onClick={() => {
                  restart.reset();
                  setRestartTarget("reference_select");
                }}
              >
                원본 다시 선택
              </Button>
            )}
            {stage === "generation" && completedGeneration && (
              <Button
                variant="default"
                size="xs"
                disabled={restartDisabled}
                onClick={() => {
                  restart.reset();
                  setRestartTarget("generation");
                }}
              >
                이미지 다시 생성
              </Button>
            )}
            {stage === "caption" && (
              <Button
                variant="default"
                disabled={!previewAvailable}
                onClick={() => setPreview(true)}
              >
                게시 미리보기
              </Button>
            )}
            {stage !== current ? (
              <Button
                onClick={() =>
                  navigate(`/posts/${encodeURIComponent(item.id)}/${current}`)
                }
              >
                현재 단계로
              </Button>
            ) : stage === "generation" && completedGeneration && !terminal ? (
              <Button
                loading={aggregate.isPending}
                disabled={mutationsPending && !aggregate.isPending}
                onClick={() =>
                  aggregate.mutate(undefined, {
                    onSuccess: () =>
                      navigate(`/posts/${encodeURIComponent(item.id)}/caption`),
                  })
                }
              >
                캡션 단계로 계속
              </Button>
            ) : (
              !terminal && (
                <Button
                  loading={execute.isPending}
                  disabled={
                    pipeline.state === "running" ||
                    draft.status === "generating" ||
                    draft.status === "regenerating"
                  }
                  onClick={() => execute.mutate()}
                >
                  {active.label} 실행
                </Button>
              )
            )}
          </Group>
        </Group>
        {aggregate.error && (
          <OperationErrorAlert
            failure={operationFailure(
              aggregate.error,
              "생성 결과를 확인하지 못했습니다.",
            )}
          />
        )}
        {execute.error && (
          <OperationErrorAlert
            failure={operationFailure(
              execute.error,
              "단계를 실행하지 못했습니다.",
            )}
          />
        )}
        {draft.errorMessage && !failed && !blocked && (
          <Alert color="red">{draft.errorMessage}</Alert>
        )}
        {view.shots.length > 1 && (
          <Group gap="xs" role="group" aria-label="사진 선택">
            {view.shots.map((s, i) => (
              <Button
                key={s.shotId}
                variant={shot?.shotId === s.shotId ? "light" : "default"}
                color="ink"
                aria-pressed={shot?.shotId === s.shotId}
                onClick={() =>
                  setSelected({ ...selected, [active.id]: s.shotId })
                }
              >
                사진 {i + 1}
              </Button>
            ))}
          </Group>
        )}
        {stage === "reference_select" && (
          <>
            <div className={styles.sourceLayout}>
              {shot && <SourceCard shot={shot} label="선택한 원본" />}
              {shot && (
                <Stack gap="sm" className={styles.referencePanel}>
                  <Text size="sm" fw={600}>
                    이 컷에 사용할 캐릭터 비주얼
                  </Text>
                  {identity.length > 0 ? (
                    <div className={styles.identities}>
                      {identity.map((reference, i) => (
                        <IdentityCard
                          key={text(reference.id) || i}
                          characterId={draft.characterId}
                          reference={reference}
                          index={i + 1}
                        />
                      ))}
                    </div>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {shot.sourceComposition?.content?.personCount === 0
                        ? "인물이 없는 컷이므로 캐릭터 비주얼을 사용하지 않습니다."
                        : "캐릭터 비주얼 선택 결과가 아직 없습니다."}
                    </Text>
                  )}
                  <details>
                    <summary>선택 이유</summary>
                    <Text mt="sm" size="sm">
                      {shot.reason || "선택 이유가 없습니다."}
                    </Text>
                  </details>
                  <details>
                    <summary>원본 캡션 보기</summary>
                    <Text mt="sm" size="sm" className={styles.preserve}>
                      {shot.sourceCaption ?? "원문 캡션이 없습니다."}
                    </Text>
                  </details>
                </Stack>
              )}
            </div>
          </>
        )}
        {stage === "image_prompt" && (
          <>
            <div className={styles.prompt}>
              <Stack gap="md" className={styles.promptPanel}>
                <Group justify="space-between">
                  <Text fw={600}>생성에 사용한 프롬프트</Text>
                  <CopyButton value={prompt.prompt}>
                    {({ copied, copy }) => (
                      <Button
                        size="xs"
                        variant="default"
                        disabled={!prompt.prompt}
                        onClick={copy}
                        leftSection={<Copy size={14} aria-hidden />}
                      >
                        {copied ? "복사됨" : "프롬프트 복사"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <Textarea
                  label="이미지 프롬프트"
                  autosize
                  minRows={14}
                  maxRows={28}
                  value={prompt.prompt}
                  placeholder="프롬프트를 실행하면 결과가 여기에 표시됩니다."
                  readOnly
                />
                <Textarea
                  label="네거티브 프롬프트"
                  autosize
                  minRows={4}
                  maxRows={10}
                  value={prompt.negativePrompt}
                  placeholder="저장된 네거티브 프롬프트가 없습니다."
                  readOnly
                />
              </Stack>
              <Stack gap="sm" className={styles.referencePanel}>
                <Text fw={600}>입력 레퍼런스</Text>
                {image(
                  source.data,
                  "원본 레퍼런스",
                  "레퍼런스 사진이 없습니다.",
                  true,
                )}
                <div className={styles.identities}>
                  {identity.map((reference, i) => (
                    <IdentityCard
                      key={text(reference.id) || i}
                      characterId={draft.characterId}
                      reference={reference}
                      index={i + 1}
                    />
                  ))}
                </div>
              </Stack>
            </div>
          </>
        )}
        {stage === "generation" && (
          <>
            <div className={styles.compare}>
              {image(source.data, "원본 레퍼런스", "레퍼런스 사진이 없습니다.")}
              {image(
                result?.url,
                "생성 결과",
                job?.errorMessage ?? "아직 생성된 사진이 없습니다.",
              )}
            </div>
            {stage === current &&
              job?.status === "queued" &&
              Array.isArray(currentJobIds) &&
              currentJobIds.includes(job.jobId) && (
                <Group>
                  <Button
                    variant="default"
                    size="sm"
                    loading={runQueued.isPending}
                    disabled={mutationsPending && !runQueued.isPending}
                    onClick={() => runQueued.mutate(job.jobId)}
                  >
                    이 컷 생성 실행
                  </Button>
                </Group>
              )}
            {runQueued.error && (
              <OperationErrorAlert
                failure={operationFailure(
                  runQueued.error,
                  "사진 생성을 실행하지 못했습니다.",
                )}
              />
            )}
            {stage === current && job?.status === "failed" && (
              <Button
                loading={retry.isPending}
                onClick={() => retry.mutate(job.jobId)}
              >
                실패한 사진 재시도
              </Button>
            )}
            {retry.error && (
              <OperationErrorAlert
                failure={operationFailure(
                  retry.error,
                  "사진을 다시 실행하지 못했습니다.",
                )}
              />
            )}
            <Group gap="xs">
              <Text size="sm" c="ink.6">
                선택한 사진
              </Text>
              {job?.status ? (
                <Badge
                  color={SHOT_STATUS_COLOR[job.status] ?? "ink"}
                  c={`${SHOT_STATUS_COLOR[job.status] ?? "ink"}.9`}
                  variant="light"
                >
                  {SHOT_STATUS_LABEL[job.status] ?? job.status}
                </Badge>
              ) : (
                <Text size="sm" c="ink.6">
                  이미지 생성 기록이 없습니다.
                </Text>
              )}
            </Group>
            {generationReady && restartDisabled && !mutationsPending && (
              <Text size="sm" c="ink.6">
                생성 결과를 다음 단계에 반영하기 전에는 다시 생성할 수 없습니다.
                ‘캡션 단계로 계속’으로 진행해 주세요.
              </Text>
            )}
          </>
        )}
        {stage === "caption" && (
          <>
            <div className={styles.compare}>
              {image(result?.url, "생성 결과", "아직 생성된 사진이 없습니다.")}
              <Stack gap="md" className={styles.promptPanel}>
                {!editableCaption && draft.status !== "published" && (
                  <Alert color="ink" title="캡션 준비 중">
                    <Text size="sm">
                      {generationReady
                        ? "이미지 생성에서 ‘캡션 단계로 계속’을 눌러 결과를 반영한 뒤 캡션을 실행하세요."
                        : current === "caption"
                          ? "캡션 단계를 실행하면 생성된 문구를 편집할 수 있습니다."
                          : "이미지 생성 단계를 완료한 뒤 캡션을 실행할 수 있습니다."}
                    </Text>
                  </Alert>
                )}
                {draft.status === "published" && (
                  <Text size="sm" c="ink.6">
                    게시된 캡션입니다. 읽기 전용으로 표시합니다.
                  </Text>
                )}
                <Textarea
                  label="캡션"
                  autosize
                  minRows={8}
                  maxRows={20}
                  value={caption ?? draft.caption}
                  onChange={(e) => setCaption(e.currentTarget.value)}
                  disabled={!editableCaption}
                />
                <Textarea
                  label="해시태그"
                  description="쉼표로 구분 · 최대 5개"
                  value={hashtags ?? draft.hashtags.join(", ")}
                  onChange={(e) => setHashtags(e.currentTarget.value)}
                  disabled={!editableCaption}
                />
                <Group>
                  <Button
                    disabled={
                      !editableCaption ||
                      !(caption ?? draft.caption).trim() ||
                      (caption ?? draft.caption).length > 2000 ||
                      (hashtags ?? draft.hashtags.join(", "))
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean).length > 5 ||
                      (caption === undefined && hashtags === undefined)
                    }
                    loading={save.isPending}
                    onClick={() =>
                      save.mutate(undefined, {
                        onSuccess: () => {
                          setCaption(undefined);
                          setHashtags(undefined);
                        },
                      })
                    }
                  >
                    캡션 저장
                  </Button>
                </Group>
                {save.error && (
                  <OperationErrorAlert
                    failure={operationFailure(
                      save.error,
                      "캡션을 저장하지 못했습니다.",
                    )}
                  />
                )}
              </Stack>
            </div>
            {terminal && draft.status !== "published" && (
              <Stack gap="sm">
                <TextInput
                  label="게시 예약"
                  type="datetime-local"
                  value={
                    scheduledAt ??
                    (draft.scheduledAt
                      ? new Date(
                          new Date(draft.scheduledAt).getTime() -
                            new Date().getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : "")
                  }
                  onChange={(event) =>
                    setScheduledAt(event.currentTarget.value)
                  }
                />
                <Group>
                  <Button
                    variant="default"
                    loading={schedule.isPending}
                    disabled={scheduledAt === undefined}
                    onClick={() =>
                      schedule.mutate(undefined, {
                        onSuccess: () => setScheduledAt(undefined),
                      })
                    }
                  >
                    예약 저장
                  </Button>
                  <Button
                    disabled={
                      caption !== undefined ||
                      hashtags !== undefined ||
                      scheduledAt !== undefined ||
                      !draft.caption.trim() ||
                      !draft.shots?.length ||
                      draft.shots.some(
                        (shot) =>
                          !shot.outputs.some((output) => output.selected),
                      )
                    }
                    onClick={() => setPublishConfirm(true)}
                  >
                    {draft.scheduledAt ? "예약 게시" : "게시하기"}
                  </Button>
                </Group>
                {schedule.error && (
                  <OperationErrorAlert
                    failure={operationFailure(
                      schedule.error,
                      "예약을 저장하지 못했습니다.",
                    )}
                  />
                )}
              </Stack>
            )}
            <details>
              <summary>참고 원문 캡션</summary>
              {rows(record(view.caption.input).sourceCaptions).length === 0 && (
                <Text mt="sm" size="sm" c="dimmed">
                  참고 원문 캡션이 없습니다.
                </Text>
              )}
              {rows(record(view.caption.input).sourceCaptions).map(
                (source, i) => (
                  <Text key={i} size="sm" mt="sm" className={styles.preserve}>
                    {text(source.caption)}
                  </Text>
                ),
              )}
            </details>
          </>
        )}
        {!shot && <Text c="dimmed">저장된 레퍼런스 선택 결과가 없습니다.</Text>}
        {source.error && (
          <Alert color="red">
            원본 사진을 불러오지 못했습니다.
            <Button variant="subtle" onClick={() => void source.refetch()}>
              다시 시도
            </Button>
          </Alert>
        )}
        <section
          id="reference-execution-records"
          className={styles.records}
          aria-label={`${active.label} 실행 기록`}
        >
          <Group justify="space-between" mb="sm">
            <Title order={3} size="h5">
              실행 기록
            </Title>
            <Text size="xs" c="ink.6">
              {active.label} · 요청과 응답 원본
            </Text>
          </Group>
          <StageExecutionRecords
            producerLogIds={
              Array.isArray(artifact?.producerLogIds)
                ? artifact.producerLogIds.filter(
                    (id): id is string => typeof id === "string",
                  )
                : undefined
            }
            producerLogId={
              artifact ? text(artifact.producerLogId) || undefined : undefined
            }
            requestId={artifact ? draft.id : undefined}
            type={
              stage === "reference_select"
                ? "admin.reference.post.selection"
                : stage === "image_prompt"
                  ? "admin.reference.post.image.prompt"
                  : stage === "caption"
                    ? "admin.reference.post.caption"
                    : undefined
            }
            generationJobId={stage === "generation" ? job?.jobId : undefined}
          />
        </section>
      </Stack>
      <Modal
        opened={!!restartTarget}
        title={
          restartTarget === "reference_select"
            ? "원본 다시 선택"
            : "이미지 다시 생성"
        }
        onClose={() => {
          if (!restart.isPending) setRestartTarget(undefined);
        }}
        closeOnClickOutside={!restart.isPending}
        closeOnEscape={!restart.isPending}
        withCloseButton={!restart.isPending}
      >
        <Stack gap="md">
          <Text>
            {restartTarget === "reference_select"
              ? "선택한 원본과 이후 프롬프트·생성 이미지·캡션을 초기화하고 원본 선택부터 다시 시작합니다."
              : "저장된 원본과 생성 입력으로 모든 사진을 다시 생성하고 기존 캡션을 초기화합니다."}
          </Text>
          {restart.error && (
            <OperationErrorAlert
              failure={operationFailure(
                restart.error,
                "다시 시작하지 못했습니다.",
              )}
            />
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={restart.isPending}
              onClick={() => setRestartTarget(undefined)}
            >
              취소
            </Button>
            <Button
              loading={restart.isPending}
              disabled={restartDisabled && !restart.isPending}
              onClick={() => {
                if (restartTarget)
                  restart.mutate(restartTarget, {
                    onSuccess: (_draft, target) => {
                      setRestartTarget(undefined);
                      setCaption(undefined);
                      setHashtags(undefined);
                      navigate(
                        `/posts/${encodeURIComponent(item.id)}/${target}`,
                      );
                    },
                  });
              }}
            >
              다시 시작
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={publishConfirm}
        onClose={() => {
          if (!publish.isPending) setPublishConfirm(false);
        }}
        title="게시 확인"
      >
        <Stack gap="md">
          <Text>
            {draft.scheduledAt
              ? item.executionMode === "manual"
                ? "예약 게시를 승인합니다. 예약 시간에 실행하려면 자동 진행으로 전환하세요."
                : "예약 게시를 승인합니다. 저장한 예약 시간에 게시합니다."
              : "이 게시물을 게시합니다."}
          </Text>
          {publish.error && (
            <OperationErrorAlert
              failure={operationFailure(publish.error, "게시하지 못했습니다.")}
            />
          )}
          <Button
            loading={publish.isPending}
            onClick={() =>
              publish.mutate(undefined, {
                onSuccess: () => setPublishConfirm(false),
              })
            }
          >
            게시 확인
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={preview}
        onClose={() => setPreview(false)}
        title="게시 미리보기"
        size="lg"
        closeButtonProps={{ "aria-label": "미리보기 닫기" }}
      >
        <Stack gap="md">
          <Group justify="space-between">
            <CharacterName id={item.characterId} fw={700} />
            <Badge color="ink" variant="light">
              {item.contentType.toUpperCase()}
            </Badge>
          </Group>
          {[...(draft.shots ?? [])]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s, i) => {
              const output = s.outputs.find((o) => o.selected) ?? s.outputs[0];
              return output ? (
                <ZoomableImage
                  key={s.jobId}
                  src={output.url}
                  alt={`게시 사진 ${i + 1}`}
                  fit="contain"
                  h={400}
                />
              ) : null;
            })}
          {!draft.shots?.some((s) => s.outputs.length > 0) && (
            <Text c="ink.6">아직 생성된 사진이 없습니다.</Text>
          )}
          <Text className={styles.preserve}>
            {(caption ?? draft.caption) || "캡션이 아직 생성되지 않았습니다."}
          </Text>
          <Text>{hashtags ?? draft.hashtags.join(", ")}</Text>
        </Stack>
      </Modal>
    </DataPage>
  );
}

function SourceCard({
  shot,
  label,
}: {
  shot: import("./reference-agent-view").ReferenceShot;
  label: string;
}) {
  const source = useQuery({
    queryKey: ["reference-source", shot.mediaId, shot.sha256],
    queryFn: () => fetchReferenceSource(shot),
  });
  return (
    <div className={styles.image}>
      <Text size="sm" fw={600}>
        {label}
      </Text>
      {source.data ? (
        <ZoomableImage
          src={source.data}
          alt={label}
          fit="contain"
          className={styles.photo}
        />
      ) : (
        <Text
          size="sm"
          c="ink.6"
          className={`${styles.placeholder} ${styles.photo}`}
        >
          {source.isPending
            ? "사진을 불러오는 중입니다."
            : source.error
              ? "원본 사진을 불러오지 못했습니다."
              : "저장된 원본 사진이 없습니다."}
        </Text>
      )}
    </div>
  );
}

function IdentityCard({
  characterId,
  reference,
  index,
}: {
  characterId: string;
  reference: Record<string, unknown>;
  index: number;
}) {
  const image = useQuery({
    queryKey: ["reference-identity", characterId, reference],
    queryFn: () => fetchReferenceIdentity(characterId, reference),
  });
  return (
    <div className={styles.image}>
      <Text size="sm" fw={600}>
        캐릭터 참조 {index}
      </Text>
      {text(reference.promptLabel) && (
        <Text size="xs" c="ink.6">
          {text(reference.promptLabel)}
        </Text>
      )}
      {image.data ? (
        <ZoomableImage
          src={image.data}
          alt={`캐릭터 참조 ${index}`}
          fit="contain"
          className={styles.identityPhoto}
        />
      ) : (
        <Text
          size="sm"
          c="ink.6"
          className={`${styles.placeholder} ${styles.identityPhoto}`}
        >
          {image.isPending
            ? "사진을 불러오는 중입니다."
            : image.error
              ? "사진을 불러오지 못했습니다."
              : "사진 주소가 없습니다."}
        </Text>
      )}
      {text(reference.reason) && (
        <details className={styles.disclosure}>
          <summary>선택 목적</summary>
          <Text size="sm" mt="xs">
            {text(reference.reason)}
          </Text>
        </details>
      )}
    </div>
  );
}
