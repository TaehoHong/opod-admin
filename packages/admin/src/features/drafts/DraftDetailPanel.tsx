import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Spoiler,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DraftPlanSummary } from "./DraftPlanSummary";
import { DraftStage, MetaRow, StageNote, type StageTone } from "./DraftStage";
import { ShotCard } from "./ShotCard";
import {
  fetchDraft,
  rejectDraft,
  runDraftStage,
  updateDraft,
  type Draft,
  type DraftConcept,
  type DraftStageAction,
} from "./api";
import { DRAFT_STATUS_COLOR, DRAFT_STATUS_LABEL } from "./labels";
import { draftDetailKey, useDraftMutation } from "./useDraftMutation";

// 워커·다른 탭·수동 실행이 만든 상태 변화를 따라가야 한다. 종료 상태에서는
// 폴링을 멈춘다.
//
// 폼이 폴링에 견디려면 두 가지가 필요하다: @mantine/form uncontrolled 모드로
// 재조회가 입력값을 덮지 않게 하고, 아래 단계 component를 module 레벨에 두어
// 렌더마다 새 component type이 만들어지지 않게 한다. 안쪽에 정의하면 매 폴링에
// 하위 트리가 통째로 remount되어 입력 중이던 캡션이 사라진다.
const POLL_INTERVAL_MS = 3000;
const TERMINAL: string[] = ["published", "rejected"];

type StageMutation = ReturnType<typeof useDraftMutation<DraftStageAction>>;

export function DraftDetailPanel({ draftId }: { draftId: string }) {
  const draft = useQuery({
    queryKey: draftDetailKey(draftId),
    queryFn: () => fetchDraft(draftId),
    refetchInterval: (query) =>
      query.state.data && TERMINAL.includes(query.state.data.status)
        ? false
        : POLL_INTERVAL_MS,
  });

  if (draft.isPending) return <Loader aria-label="초안 불러오는 중" />;
  if (draft.error) {
    return (
      <Alert color="red" role="alert" title="불러오지 못했습니다">
        {draft.error.message}
      </Alert>
    );
  }

  return <DraftTimeline draft={draft.data} />;
}

function DraftTimeline({ draft }: { draft: Draft }) {
  const concept = draft.conceptJson ?? {};
  const mode = concept.mode === "manual" ? "manual" : "auto";

  const stage = useDraftMutation(draft.id, (action: DraftStageAction) =>
    runDraftStage(draft.id, action),
  );

  return (
    <Paper p="md" component="section">
      <Stack gap="xs">
        <Group gap="sm" align="baseline" wrap="wrap">
          <Title order={5}>초안 상세</Title>
          <Badge color={DRAFT_STATUS_COLOR[draft.status]}>
            {DRAFT_STATUS_LABEL[draft.status]}
          </Badge>
          <Badge
            variant="light"
            color={mode === "manual" ? "attention" : "ink"}
          >
            {mode === "manual" ? "수동 진행" : "자동 진행"}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          시도 {draft.attemptCount} · {draft.contentType} · 생성{" "}
          {draft.createdAt.replace("T", " ").slice(0, 16)}
        </Text>

        {draft.errorMessage ? (
          <Alert color="red" title="오류">
            {draft.errorMessage}
          </Alert>
        ) : null}
        {stage.isError ? (
          <Alert color="red" role="alert" title="실행하지 못했습니다">
            {stage.error.message}
          </Alert>
        ) : null}

        <Stack gap={0} mt="xs">
          <StageCreated draft={draft} concept={concept} mode={mode} />
          <StagePlan draft={draft} concept={concept} stage={stage} />
          <StageShots
            draft={draft}
            concept={concept}
            mode={mode}
            stage={stage}
          />
          <StageReview draft={draft} stage={stage} />
          <StagePublish draft={draft} stage={stage} />
        </Stack>

        {draft.conceptJson ? (
          <Spoiler
            maxHeight={0}
            showLabel="원본 데이터 (conceptJson)"
            hideLabel="접기"
          >
            <Code block mt="xs">
              {JSON.stringify(draft.conceptJson, null, 2)}
            </Code>
          </Spoiler>
        ) : null}
      </Stack>
    </Paper>
  );
}

function formatMoment(value?: string, fallback = "—"): string {
  return value ? value.replace("T", " ").slice(0, 16) : fallback;
}

function StageCreated({
  draft,
  concept,
  mode,
}: {
  draft: Draft;
  concept: DraftConcept;
  mode: string;
}) {
  return (
    <DraftStage step={1} tone="done" label="① 초안 생성" status="완료">
      <Stack gap={4}>
        <MetaRow label="장면 힌트">{concept.sceneHint || "—"}</MetaRow>
        <MetaRow label="진행 방식">
          {mode === "manual"
            ? "수동 — 단계별 버튼으로 진행"
            : "자동 — 워커가 끝까지 진행"}
        </MetaRow>
        <MetaRow label="출처">
          {concept.source === "manual"
            ? "운영자"
            : concept.source === "scheduler"
              ? "스케줄러"
              : "—"}
        </MetaRow>
        <MetaRow label="게시 예정">
          {formatMoment(draft.scheduledAt, "승인 즉시")}
        </MetaRow>
      </Stack>
    </DraftStage>
  );
}

const PLAN_NOTE =
  "페르소나·메모리·최근 게시물을 입력으로 LLM이 캡션과 컷 장면을 기획합니다.";

function StagePlan({
  draft,
  concept,
  stage,
}: {
  draft: Draft;
  concept: DraftConcept;
  stage: StageMutation;
}) {
  const label = "② 기획 · LLM";

  if (concept.plan) {
    return (
      <DraftStage step={2} tone="done" label={label} status="완료">
        <DraftPlanSummary concept={concept} />
      </DraftStage>
    );
  }
  if (draft.status === "planned") {
    return (
      <DraftStage
        step={2}
        tone="current"
        label={label}
        status="대기"
        action={
          <Button
            size="compact-sm"
            loading={stage.isPending && stage.variables === "plan"}
            onClick={() => stage.mutate("plan")}
          >
            지금 기획 실행
          </Button>
        }
      >
        <StageNote>{PLAN_NOTE}</StageNote>
      </DraftStage>
    );
  }
  if (draft.status === "generating") {
    return (
      <DraftStage step={2} tone="current" label={label} status="실행 중">
        <StageNote>기획(LLM)을 실행하는 중입니다…</StageNote>
      </DraftStage>
    );
  }
  if (draft.status === "failed") {
    return (
      <DraftStage step={2} tone="failed" label={label} status="실패">
        <StageNote>기획에 실패했습니다. {draft.errorMessage ?? ""}</StageNote>
      </DraftStage>
    );
  }
  return (
    <DraftStage step={2} tone="future" label={label} status="대기">
      <StageNote>{PLAN_NOTE}</StageNote>
    </DraftStage>
  );
}

function StageShots({
  draft,
  concept,
  mode,
  stage,
}: {
  draft: Draft;
  concept: DraftConcept;
  mode: string;
  stage: StageMutation;
}) {
  const shots = draft.shots ?? [];
  const planShots = concept.plan?.shots ?? [];
  const shotCount = shots.length || planShots.length;
  const completed = shots.filter((shot) => shot.status === "completed").length;
  const hasActive = shots.some((shot) =>
    ["draft", "queued", "running"].includes(shot.status),
  );
  const hasFailed = shots.some((shot) => shot.status === "failed");
  const draftShots = shots.filter((shot) => shot.status === "draft");

  let tone: StageTone;
  let status: string;
  if (shots.length > 0 && completed === shots.length) {
    tone = "done";
    status = "완료";
  } else if (shots.length === 0) {
    tone = concept.plan ? "current" : "future";
    status = "대기";
  } else if (hasFailed && !hasActive) {
    tone = "failed";
    status = `${completed}/${shotCount}`;
  } else {
    tone = "current";
    status = `${completed}/${shotCount} 완료`;
  }

  // 수동 모드에서 draft 상태 컷이 남아 있으면 프롬프트 빌드를 노출한다.
  // 빌드 = 기획된 장면을 이미지 모델용 프롬프트로 바꾸는 별도 스텝.
  const buildAction =
    mode === "manual" && draftShots.length > 0 ? (
      <Button
        variant="default"
        size="compact-sm"
        loading={stage.isPending && stage.variables === "build-prompts"}
        onClick={() => stage.mutate("build-prompts")}
      >
        {draftShots.some((shot) => !shot.prompt)
          ? "프롬프트 빌드"
          : "프롬프트 다시 빌드"}
      </Button>
    ) : undefined;

  return (
    <DraftStage
      step={3}
      tone={tone}
      label={`③ 이미지 생성 — 컷 ${shotCount || "?"}`}
      status={status}
      action={buildAction}
    >
      {shots.length === 0 ? (
        <StageNote>기획이 완료되면 컷이 생성됩니다.</StageNote>
      ) : (
        <Stack gap="sm">
          {concept.builderName ? (
            <Text size="xs" c="dimmed">
              빌더: {concept.builderName}
            </Text>
          ) : null}
          {shots.map((shot) => (
            <ShotCard key={shot.jobId} draft={draft} shot={shot} />
          ))}
        </Stack>
      )}
    </DraftStage>
  );
}

function StageReview({ draft, stage }: { draft: Draft; stage: StageMutation }) {
  const shots = draft.shots ?? [];
  const reviewable = draft.status === "needs_review";
  const editable = reviewable || draft.status === "approved";
  const selectedShots = shots.filter((shot) =>
    shot.outputs.some((output) => output.selected),
  ).length;
  const selectionComplete = shots.length > 0 && selectedShots === shots.length;

  let tone: StageTone = "future";
  let status = "대기";
  let action: ReactNode;

  if (reviewable) {
    tone = "current";
    status = "검수 필요";
    action = (
      <Button
        size="compact-sm"
        disabled={!selectionComplete}
        loading={stage.isPending && stage.variables === "approve"}
        onClick={() => stage.mutate("approve")}
      >
        승인
      </Button>
    );
  } else if (draft.status === "approved" || draft.status === "published") {
    tone = "done";
    status = "승인됨";
  } else if (draft.status === "rejected") {
    tone = "failed";
    status = "반려됨";
  } else if (
    (draft.status === "generating" || draft.status === "regenerating") &&
    shots.length > 0 &&
    shots.every((shot) => shot.status === "completed")
  ) {
    // 컷은 전부 끝났지만 아직 집계 전 — 워커 폴링을 기다리지 않고 넘긴다.
    tone = "current";
    status = "집계 대기";
    action = (
      <Button
        size="compact-sm"
        loading={stage.isPending && stage.variables === "aggregate"}
        onClick={() => stage.mutate("aggregate")}
      >
        검수로 보내기
      </Button>
    );
  }

  return (
    <DraftStage
      step={4}
      tone={tone}
      label="④ 검수 · 승인"
      status={status}
      action={action}
    >
      <Stack gap="sm">
        {reviewable && !selectionComplete ? (
          <Alert color="attention">
            게시 이미지 {selectedShots}/{shots.length} 선택 · 컷마다 한 장을
            선택하면 승인할 수 있습니다.
          </Alert>
        ) : null}
        {editable ? (
          <DraftEditForm draft={draft} />
        ) : (
          <Stack gap={4}>
            <Text size="sm">
              {draft.caption ? `“${draft.caption}”` : "캡션 없음"}
            </Text>
            <Group gap={4}>
              {draft.hashtags.map((tag) => (
                <Badge key={tag} variant="light" color="ink">
                  #{tag}
                </Badge>
              ))}
            </Group>
          </Stack>
        )}
        {reviewable ? <DraftRejectForm draft={draft} /> : null}
      </Stack>
    </DraftStage>
  );
}

function StagePublish({
  draft,
  stage,
}: {
  draft: Draft;
  stage: StageMutation;
}) {
  if (draft.status === "published") {
    return (
      <DraftStage step={5} tone="done" label="⑤ 게시" status="게시됨" last>
        <Stack gap={4}>
          <Text size="sm">게시됨 · post {draft.publishedPostId ?? "—"}</Text>
          <StageNote>게시 시 캐릭터 메모리에 자동 역반영되었습니다.</StageNote>
        </Stack>
      </DraftStage>
    );
  }
  if (draft.status === "approved") {
    return (
      <DraftStage
        step={5}
        tone="current"
        label="⑤ 게시"
        status="게시 대기"
        last
        action={
          <Button
            size="compact-sm"
            loading={stage.isPending && stage.variables === "publish"}
            onClick={() => stage.mutate("publish")}
          >
            지금 게시
          </Button>
        }
      >
        <StageNote>
          예정 시각({formatMoment(draft.scheduledAt, "승인 즉시")})과 무관하게
          즉시 게시합니다.
        </StageNote>
      </DraftStage>
    );
  }
  if (draft.status === "rejected") {
    return (
      <DraftStage step={5} tone="failed" label="⑤ 게시" status="반려됨" last>
        <StageNote>반려된 초안은 게시되지 않습니다.</StageNote>
      </DraftStage>
    );
  }
  return (
    <DraftStage step={5} tone="future" label="⑤ 게시" status="대기" last>
      <StageNote>승인 후 게시할 수 있습니다.</StageNote>
    </DraftStage>
  );
}

// datetime-local은 로컬 시각 문자열을 준다. 서버는 ISO를 기대하므로
// 값이 있을 때만 변환해 보낸다.
function toIsoOrNull(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function DraftEditForm({ draft }: { draft: Draft }) {
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      caption: draft.caption,
      hashtags: draft.hashtags.join(", "),
      scheduledAt: draft.scheduledAt
        ? new Date(draft.scheduledAt).toISOString().slice(0, 16)
        : "",
    },
  });

  const save = useDraftMutation(draft.id, (values: typeof form.values) =>
    updateDraft(draft.id, {
      caption: values.caption,
      hashtags: values.hashtags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      scheduledAt: toIsoOrNull(values.scheduledAt),
    }),
  );

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack gap="xs">
        <Textarea
          label="캡션"
          autosize
          minRows={3}
          key={form.key("caption")}
          {...form.getInputProps("caption")}
        />
        <TextInput
          label="해시태그"
          description="쉼표로 구분"
          key={form.key("hashtags")}
          {...form.getInputProps("hashtags")}
        />
        <TextInput
          label="게시 예정"
          description="비우면 승인 즉시"
          type="datetime-local"
          w={240}
          key={form.key("scheduledAt")}
          {...form.getInputProps("scheduledAt")}
        />
        {save.isError ? (
          <Alert color="red" role="alert" title="저장하지 못했습니다">
            {save.error.message}
          </Alert>
        ) : null}
        <Group>
          <Button type="submit" variant="default" loading={save.isPending}>
            저장
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// 반려는 파이프라인을 끝내므로 사유를 남길 자리를 준다. 서버 DTO가 선택
// 항목이라 강제하지는 않는다.
function DraftRejectForm({ draft }: { draft: Draft }) {
  const form = useForm({ mode: "uncontrolled", initialValues: { reason: "" } });
  const reject = useDraftMutation(draft.id, (values: { reason: string }) =>
    rejectDraft(draft.id, values.reason.trim() || undefined),
  );

  return (
    <form onSubmit={form.onSubmit((values) => reject.mutate(values))}>
      <Group gap="xs" align="flex-end">
        <TextInput
          label="반려 사유"
          description="선택"
          placeholder="반려 사유"
          w={280}
          key={form.key("reason")}
          {...form.getInputProps("reason")}
        />
        <Button type="submit" variant="default" loading={reject.isPending}>
          반려
        </Button>
      </Group>
      {reject.isError ? (
        <Text size="xs" c="red" role="alert" mt={4}>
          {reject.error.message}
        </Text>
      ) : null}
    </form>
  );
}
