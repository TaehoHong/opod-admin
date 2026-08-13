import {
  Alert,
  Anchor,
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
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import { DraftPlanSummary } from "../drafts/DraftPlanSummary";
import { EvaluationChips } from "../drafts/EvaluationChips";
import { ShotCard } from "../drafts/ShotCard";
import {
  fetchDraft,
  fetchDraftEvaluations,
  rejectDraft,
  runDraftStage,
  updateDraft,
  updateDraftPlan,
  updateDraftPrompts,
  type Draft,
  type DraftEvaluation,
} from "../drafts/api";
import { DRAFT_STATUS_COLOR, DRAFT_STATUS_LABEL } from "../drafts/labels";
import { draftDetailKey, useDraftMutation } from "../drafts/useDraftMutation";
import {
  PostInteractionModal,
  type PostInteraction,
} from "./PostInteractionModal";
import {
  fetchPost,
  fetchPostWorkItem,
  type PostListItem,
  type PostWorkItem,
  type PostWorkStage,
  type V3MemoryCandidate,
  type V3PlanningInput,
} from "./api";
import styles from "./PostWorkPage.module.css";

const POLL_INTERVAL_MS = 3000;
const LEGACY_STAGES: { id: PostWorkStage; label: string }[] = [
  { id: "brief", label: "브리프" },
  { id: "plan", label: "기획" },
  { id: "prompt", label: "프롬프트" },
  { id: "evaluation", label: "평가" },
  { id: "generation", label: "이미지 생성" },
  { id: "review", label: "검수" },
  { id: "publish", label: "게시" },
  { id: "memory", label: "메모리" },
];

type V3PipelineStage = NonNullable<PostWorkItem["pipelineV3"]>["stage"];

// 레일 단계 id와 파이프라인 stage 어휘는 프롬프트 한 곳에서 갈린다
// (`prompt` ↔ `image_prompt`). 배열을 따로 두면 순서가 어긋나도 조용히
// 통과하므로 한 테이블에 나란히 둔다. 브리프는 Agent 단계가 아니라 입력이다.
const V3_STAGES: {
  id: PostWorkStage;
  label: string;
  pipeline: V3PipelineStage | null;
}[] = [
  { id: "brief", label: "브리프", pipeline: null },
  { id: "post_plan", label: "게시글 기획", pipeline: "post_plan" },
  { id: "image_plan", label: "이미지 기획", pipeline: "image_plan" },
  { id: "prompt", label: "프롬프트", pipeline: "image_prompt" },
  { id: "generation", label: "이미지 생성", pipeline: "generation" },
  { id: "review", label: "검수", pipeline: "review" },
  { id: "publish", label: "게시", pipeline: "publish" },
  { id: "memory", label: "메모리", pipeline: "memory" },
];
const STAGE_NUMBER = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

export function PostWorkPage({
  workId,
  stage,
}: {
  workId: string;
  stage?: string;
}) {
  const work = useQuery({
    queryKey: ["post-work-items", "detail", workId],
    queryFn: () => fetchPostWorkItem(workId),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const draftId = work.data?.draftId;
  const postId = work.data?.postId;
  const draft = useQuery({
    queryKey: draftDetailKey(draftId ?? ""),
    queryFn: () => fetchDraft(draftId!),
    enabled: Boolean(draftId),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const evaluations = useQuery({
    queryKey: [...draftDetailKey(draftId ?? ""), "evaluations"],
    queryFn: () => fetchDraftEvaluations(draftId!),
    enabled: Boolean(draftId),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const post = useQuery({
    queryKey: ["posts", "detail", postId],
    queryFn: () => fetchPost(postId!),
    enabled: Boolean(postId),
  });

  if (work.isPending) {
    return <Loader aria-label="게시물 작업 불러오는 중" />;
  }
  if (work.error) {
    return (
      <Alert color="red" role="alert" title="게시물을 불러오지 못했습니다">
        {work.error.message}
      </Alert>
    );
  }
  if (!stage) {
    return (
      <Navigate
        to={`/posts/${encodeURIComponent(workId)}/${work.data.currentStage}`}
        replace
      />
    );
  }
  if (!isStage(stage)) {
    return (
      <Navigate
        to={`/posts/${encodeURIComponent(workId)}/${work.data.currentStage}`}
        replace
      />
    );
  }
  if (work.data.pipelineV3 && (stage === "plan" || stage === "evaluation")) {
    return (
      <Navigate
        to={`/posts/${encodeURIComponent(workId)}/${stage === "plan" ? "post_plan" : "prompt"}`}
        replace
      />
    );
  }
  if (draftId && draft.isPending) {
    return <Loader aria-label="게시물 단계 불러오는 중" />;
  }
  if (draft.error) {
    return (
      <Alert color="red" role="alert" title="단계를 불러오지 못했습니다">
        {draft.error.message}
      </Alert>
    );
  }

  return (
    <DataPage
      title={work.data.caption || "기획 전 게시물"}
      isPending={false}
      actions={
        <Button component={Link} to="/posts" variant="default">
          목록으로
        </Button>
      }
    >
      <PostWorkHeader item={work.data} draft={draft.data} />
      <StageRail item={work.data} activeStage={stage} />
      {evaluations.error ? (
        <Alert color="yellow" title="평가를 불러오지 못했습니다">
          다른 단계는 계속 진행할 수 있습니다. {evaluations.error.message}
        </Alert>
      ) : null}
      <StageBody
        stage={stage}
        item={work.data}
        draft={draft.data}
        evaluations={evaluations.data?.items ?? []}
        post={post.data}
      />
    </DataPage>
  );
}

function PostWorkHeader({
  item,
  draft,
}: {
  item: PostWorkItem;
  draft?: Draft;
}) {
  return (
    <Paper p="md" component="section">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={4}>
          <Group gap="xs" wrap="wrap">
            <CharacterName id={item.characterId} />
            <Badge variant="light" color="ink">
              {item.contentType}
            </Badge>
            {draft ? (
              <Badge color={DRAFT_STATUS_COLOR[draft.status]}>
                {DRAFT_STATUS_LABEL[draft.status]}
              </Badge>
            ) : (
              <Badge color="teal">게시 완료</Badge>
            )}
            <Badge
              color={item.executionMode === "manual" ? "attention" : "accent"}
            >
              {item.executionMode === "manual" ? "수동 진행" : "자동 진행"}
            </Badge>
            {/* 어느 세대의 파이프라인을 보고 있는지가 화면 어디에도 없어서
                "이미지 기획 단계가 없다"는 오해가 났다. */}
            {item.kind === "draft" ? (
              <Badge variant="outline" color={item.pipelineV3 ? "teal" : "ink"}>
                {item.pipelineV3 ? "Agent V3" : "V2 legacy"}
              </Badge>
            ) : null}
          </Group>
          <Text size="xs" c="dimmed">
            {sourceLabel(item.source)} · 최근 변경{" "}
            {formatDateTime(item.updatedAt)}
          </Text>
        </Stack>
        <Stack gap={2} align="flex-end">
          <Text size="sm" fw={600}>
            {item.statusDetail}
          </Text>
          <Text size="xs" c="dimmed">
            게시 일정 ·{" "}
            {item.scheduledAt
              ? formatDateTime(item.scheduledAt)
              : "승인 후 즉시"}
          </Text>
        </Stack>
      </Group>
      {item.executionMode === "auto" ? (
        <Alert color="blue" mt="sm">
          자동 작업입니다. 내용을 수정하거나 후보를 교체하면 이 게시물만 수동
          진행으로 전환됩니다.
        </Alert>
      ) : null}
      {draft?.errorMessage ? (
        <Alert color="red" title="현재 오류" mt="sm">
          {draft.errorMessage}
        </Alert>
      ) : null}
      {item.pipelineV3 &&
      !["pending", "running", "ready"].includes(item.pipelineV3.state) ? (
        <Alert
          color={item.pipelineV3.state === "failed" ? "red" : "yellow"}
          title={item.statusDetail}
          mt="sm"
        >
          <Text size="sm">다음 행동 · {item.pipelineV3.nextAction}</Text>
          {item.pipelineV3.reasonCodes.length ? (
            <Text size="xs" c="dimmed">
              사유 코드 · {item.pipelineV3.reasonCodes.join(", ")}
            </Text>
          ) : null}
        </Alert>
      ) : null}
    </Paper>
  );
}

function StageRail({
  item,
  activeStage,
}: {
  item: PostWorkItem;
  activeStage: PostWorkStage;
}) {
  const stages = item.pipelineV3 ? V3_STAGES : LEGACY_STAGES;
  return (
    <nav className={styles.rail} aria-label="게시물 생성 단계">
      {stages.map((stage, index) => {
        const active = stage.id === activeStage;
        const done = index + 1 < item.stageIndex;
        const skipped = item.kind === "post" && done;
        const state = railStageState(item, stage.id, index);
        return (
          <Link
            key={stage.id}
            className={`${styles.stageLink} ${active ? styles.active : ""} ${state === "done" && !skipped ? styles.done : ""}`}
            to={`/posts/${encodeURIComponent(item.id)}/${stage.id}`}
            aria-current={active ? "step" : undefined}
          >
            <Stack gap={0}>
              <Text size="sm" fw={600}>
                {STAGE_NUMBER[index]} {stage.label}
              </Text>
              {/* 레일과 단계 본문이 같은 어휘를 쓴다. 단계를 옮길 때마다 읽는
                  법을 새로 배우지 않아야 한다. "현재 화면"은 테두리와
                  aria-current가 이미 말한다. */}
              <Text size="xs" c="dimmed">
                {skipped ? "건너뜀" : STAGE_STATE_COPY[state].label}
              </Text>
            </Stack>
          </Link>
        );
      })}
    </nav>
  );
}

// 레일 한 칸의 상태. V3는 파이프라인 상태를 그대로 쓰고, legacy는 단계 순서와
// 대표 상태로 같은 5개 어휘에 맞춘다.
function railStageState(
  item: PostWorkItem,
  stage: PostWorkStage,
  index: number,
): V3StageState {
  const pipeline = V3_STAGES.find((entry) => entry.id === stage)?.pipeline;
  if (item.pipelineV3 && pipeline) {
    return v3StageState(item.pipelineV3, pipeline);
  }
  // 브리프는 Agent 단계가 아니라 입력이다. 초안이 있으면 이미 확정돼 있다.
  if (stage === "brief") return "done";
  if (index + 1 < item.stageIndex) return "done";
  if (index + 1 > item.stageIndex) return "waiting";
  if (item.operationalStatus === "failed") return "failed";
  if (item.operationalStatus === "agent_running") return "running";
  return item.operationalStatus === "completed" ? "done" : "waiting";
}

function StageBody({
  stage,
  item,
  draft,
  evaluations,
  post,
}: {
  stage: PostWorkStage;
  item: PostWorkItem;
  draft?: Draft;
  evaluations: DraftEvaluation[];
  post?: PostListItem;
}) {
  if (!draft && stage !== "publish" && stage !== "memory") {
    return <UnavailableStage stage={stage} />;
  }
  if (stage === "brief") return <BriefStage item={item} draft={draft!} />;
  if (stage === "post_plan") {
    return <V3PostPlanStage item={item} evaluations={evaluations} />;
  }
  if (stage === "image_plan") {
    return <V3ImagePlanStage item={item} evaluations={evaluations} />;
  }
  if (stage === "plan")
    return <PlanStage key={draft!.updatedAt} draft={draft!} />;
  if (stage === "prompt") {
    return item.pipelineV3 ? (
      <V3PromptStage item={item} evaluations={evaluations} />
    ) : (
      <PromptStage key={draft!.updatedAt} draft={draft!} />
    );
  }
  if (stage === "evaluation") {
    return <EvaluationStage draft={draft!} evaluations={evaluations} />;
  }
  if (stage === "generation") {
    return (
      <GenerationStage item={item} draft={draft!} evaluations={evaluations} />
    );
  }
  if (stage === "review") {
    return <ReviewStage item={item} draft={draft!} evaluations={evaluations} />;
  }
  if (stage === "publish") {
    return <PublishStage item={item} draft={draft} post={post} />;
  }
  return <MemoryStage item={item} draft={draft} />;
}

function V3PostPlanStage({
  item,
  evaluations,
}: {
  item: PostWorkItem;
  evaluations: DraftEvaluation[];
}) {
  const artifact = item.pipelineV3?.artifacts.postPlan;
  return (
    <V3Stage
      item={item}
      evaluations={evaluations}
      stage="post_plan"
      number="②"
      title="게시글 기획"
      description="캐릭터 맥락을 바탕으로 게시글 의도와 문안을 확정합니다."
      evaluationKind="plan"
      evaluationLabel="게시글 평가"
      runLabel="게시글 기획"
      lineage={artifact}
      status={artifact?.status}
    >
      {artifact ? <PostPlanArtifact artifact={artifact} /> : null}
    </V3Stage>
  );
}

function V3ImagePlanStage({
  item,
  evaluations,
}: {
  item: PostWorkItem;
  evaluations: DraftEvaluation[];
}) {
  const artifact = item.pipelineV3?.artifacts.imagePlan;
  return (
    <V3Stage
      item={item}
      evaluations={evaluations}
      stage="image_plan"
      number="③"
      title="이미지 기획"
      description="확정된 게시글을 몇 장의 이미지로 보여줄지 구성합니다."
      evaluationKind="image_plan"
      evaluationLabel="이미지 기획 평가"
      runLabel="이미지 기획"
      lineage={artifact}
      status={artifact?.status}
    >
      {artifact ? (
        <ImagePlanArtifact
          artifact={artifact}
          imageCount={item.pipelineV3?.imageCount ?? null}
        />
      ) : null}
    </V3Stage>
  );
}

// V3 단계 공통 틀 — 상태 칩, 산출물 슬롯, 계보 푸터, 평가 블록, 실행/재실행을
// 모든 단계가 같은 자리에 둔다. 단계를 옮길 때마다 읽는 법이 달라지지 않게 한다.
function V3Stage({
  item,
  evaluations,
  stage,
  number,
  title,
  description,
  evaluationKind,
  evaluationLabel,
  runLabel,
  lineage,
  status,
  children,
}: {
  item: PostWorkItem;
  evaluations: DraftEvaluation[];
  stage: V3PipelineStage;
  number: string;
  title: string;
  description: string;
  evaluationKind: DraftEvaluation["kind"];
  evaluationLabel: string;
  runLabel: string;
  lineage?: { revision: number; hash?: string; contractVersion?: string };
  status?: string;
  children?: React.ReactNode;
}) {
  const pipeline = item.pipelineV3;
  const evaluation = latestEvaluation(evaluations, evaluationKind);
  const run = useDraftMutation(item.draftId ?? "", () =>
    runDraftStage(item.draftId!, "plan"),
  );
  const stageState = v3StageState(pipeline, stage);
  const current = pipeline?.stage === stage;
  // 완료된 단계도 다시 돌릴 수 있어야 한다. 현재 단계가 아닌 뒤 단계는 이 화면에서
  // 실행하지 않는다 — 오케스트레이터가 순서를 소유한다.
  const runnable =
    Boolean(item.draftId) &&
    stageState !== "running" &&
    (current || stageState === "done");
  return (
    <StagePaper
      title={`${number} ${title}`}
      description={description}
      status={<StageStateBadge state={stageState} />}
    >
      {stageState === "running" ? (
        <Group gap="xs" role="status">
          <Loader size="sm" />
          <Text size="sm">{runLabel} Agent 실행 중…</Text>
        </Group>
      ) : null}
      {children ?? (
        <Alert color="gray">아직 이 단계의 산출물이 없습니다.</Alert>
      )}
      {lineage ? <Lineage lineage={lineage} status={status} /> : null}
      <EvaluationBlock label={evaluationLabel} evaluation={evaluation} />
      {current && pipeline ? (
        <Alert color="blue">다음 행동 · {pipeline.nextAction}</Alert>
      ) : null}
      {run.isError ? <MutationError error={run.error} /> : null}
      {runnable ? (
        <Group>
          <Button
            loading={run.isPending}
            variant={stageState === "done" ? "default" : "filled"}
            onClick={() => run.mutate(undefined)}
          >
            {stageState === "done"
              ? `${runLabel} 다시 실행`
              : `${runLabel} 실행`}
          </Button>
        </Group>
      ) : null}
    </StagePaper>
  );
}

function PostPlanArtifact({
  artifact,
}: {
  artifact: NonNullable<
    NonNullable<PostWorkItem["pipelineV3"]>["artifacts"]["postPlan"]
  >;
}) {
  return (
    <Paper p="md">
      <Stack gap="sm">
        {artifact.caption ? (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              캡션
            </Text>
            {/* 캡션은 최종 게시 본문이다. 줄바꿈을 보존해 그대로 읽게 한다. */}
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {artifact.caption}
            </Text>
          </Stack>
        ) : null}
        {artifact.hashtags?.length ? (
          <Group gap="xs" wrap="wrap">
            {artifact.hashtags.map((tag) => (
              <Badge key={tag} variant="light">
                #{tag}
              </Badge>
            ))}
          </Group>
        ) : null}
        {artifact.premise ? <Meta label="전제">{artifact.premise}</Meta> : null}
        {artifact.primaryPurpose ? (
          <Meta label="주 목적">{artifact.primaryPurpose}</Meta>
        ) : null}
        {artifact.secondaryPurpose ? (
          <Meta label="부 목적">{artifact.secondaryPurpose}</Meta>
        ) : null}
        {artifact.captionLanguages?.length ? (
          <Meta label="언어">{artifact.captionLanguages.join(", ")}</Meta>
        ) : null}
        {artifact.memoryCandidates ? (
          <Meta label="새 기억">
            {artifact.memoryCandidates.length === 0 ? (
              // 빈 배열은 "표시할 게 없음"이 아니라 "세계관에 새 사실을 더하지
              // 않는다"는 판정이다.
              "없음"
            ) : (
              <Stack gap={2}>
                {artifact.memoryCandidates.map((candidate, index) => (
                  <Group
                    key={`${candidate.type}:${index}`}
                    gap={6}
                    align="baseline"
                    wrap="nowrap"
                  >
                    <Badge size="xs" variant="light">
                      {candidate.type}
                    </Badge>
                    <Text size="sm">{candidate.content}</Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Meta>
        ) : null}
        {artifact.conflicts?.length ? (
          <Alert color="attention" title="확정 사실과 충돌">
            <Stack gap={4}>
              {artifact.conflicts.map((conflict, index) => (
                <Text key={index} size="sm">
                  {conflict.left} ↔ {conflict.right} · {conflict.reason}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}

const PRESENTATION_MODE: Record<string, string> = {
  none: "인물 없음",
  full: "전신",
  partial: "부분",
  reflection: "반사",
  silhouette: "실루엣",
};

function ImagePlanArtifact({
  artifact,
  imageCount,
}: {
  artifact: NonNullable<
    NonNullable<PostWorkItem["pipelineV3"]>["artifacts"]["imagePlan"]
  >;
  imageCount: number | null;
}) {
  return (
    <Stack gap="sm">
      <Paper p="md">
        <Stack gap="xs">
          <Meta label="이미지 장수">
            {artifact.shotCount ?? imageCount ?? "—"}장
            <Text span size="xs" c="dimmed">
              {" "}
              (오케스트레이터가 정한 값)
            </Text>
          </Meta>
          {artifact.locationId ? (
            <Meta label="장소">{artifact.locationId}</Meta>
          ) : (
            <Meta label="장소">카탈로그 미등록 단일 장소</Meta>
          )}
        </Stack>
      </Paper>
      {artifact.blockedReasons?.length ? (
        <Alert color="attention" title="시각화할 수 없습니다">
          <Stack gap={4}>
            {artifact.blockedReasons.map((reason) => (
              <Group key={reason.code} gap={6} align="baseline" wrap="nowrap">
                <Badge size="xs" color="attention">
                  {reason.code}
                </Badge>
                <Text size="sm">{reason.detail}</Text>
              </Group>
            ))}
          </Stack>
        </Alert>
      ) : null}
      {/* 연속성 잠금은 컷을 가로지르는 제약이라 컷 카드 밖에 둔다. */}
      {artifact.lockedElements?.length ? (
        <Paper p="md">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              연속성 잠금
            </Text>
            {artifact.lockedElements.map((lock, index) => (
              <Group key={index} gap="xs" align="baseline" wrap="nowrap">
                <Badge size="xs" variant="light">
                  {lock.category}
                </Badge>
                <Text size="sm">{lock.description}</Text>
                <Text size="xs" c="dimmed">
                  컷 {lock.appliesToShots.map((shot) => shot + 1).join(", ")}
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      ) : null}
      {artifact.shots?.map((shot) => (
        <Paper key={shot.sortOrder} p="md">
          <Stack gap="xs">
            <Group gap="xs" wrap="wrap">
              <Text size="sm" fw={600}>
                컷 {shot.sortOrder + 1}
              </Text>
              {shot.presentation ? (
                <>
                  <Badge size="xs" variant="light">
                    {PRESENTATION_MODE[shot.presentation.mode] ??
                      shot.presentation.mode}
                  </Badge>
                  {shot.presentation.faceVisible ? (
                    <Badge size="xs" color="attention">
                      얼굴 노출
                    </Badge>
                  ) : null}
                  {shot.presentation.identityPreservationRequired ? (
                    <Badge size="xs" color="accent">
                      정체성 보존 필요
                    </Badge>
                  ) : null}
                </>
              ) : null}
            </Group>
            {shot.visualPurpose ? (
              <Text size="xs" c="dimmed">
                {shot.visualPurpose}
              </Text>
            ) : null}
            {/* scene(프레임 안)과 captureSetup(프레임 밖)의 혼입이 기존 품질
                결함의 핵심이라 화면에서도 갈라 놓는다. */}
            {shot.scene ? <Meta label="장면">{shot.scene}</Meta> : null}
            {shot.captureSetup ? (
              <Meta label="촬영">{shot.captureSetup}</Meta>
            ) : null}
            {shot.presentation?.visibleParts.length ? (
              <Meta label="보이는 부위">
                {shot.presentation.visibleParts.join(", ")}
              </Meta>
            ) : null}
            {shot.referenceBindings?.length ? (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  레퍼런스
                </Text>
                {shot.referenceBindings.map((binding) => (
                  <Group key={binding.bindingId} gap="xs" wrap="wrap">
                    <Badge
                      size="xs"
                      color={binding.source === "identity" ? "accent" : "ink"}
                    >
                      {binding.source}
                    </Badge>
                    <Text size="xs">{binding.semanticPurposes.join(", ")}</Text>
                    <Spoiler
                      maxHeight={0}
                      showLabel="보존·복제금지"
                      hideLabel="접기"
                    >
                      <Text size="xs" c="dimmed">
                        보존 · {binding.preserve.join(" / ") || "없음"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        복제 금지 · {binding.avoidCopying.join(" / ") || "없음"}
                      </Text>
                    </Spoiler>
                  </Group>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

type V3StageState = "waiting" | "running" | "done" | "paused" | "failed";

function v3StageState(
  pipeline: PostWorkItem["pipelineV3"],
  stage: V3PipelineStage,
): V3StageState {
  if (!pipeline) return "waiting";
  const order = V3_STAGES.flatMap((entry) =>
    entry.pipeline ? [entry.pipeline] : [],
  );
  const current = order.indexOf(pipeline.stage);
  const target = order.indexOf(stage);
  if (target < current) return "done";
  if (target > current) return "waiting";
  if (pipeline.state === "running") return "running";
  if (pipeline.state === "failed") return "failed";
  if (pipeline.state === "ready") return "done";
  if (pipeline.state === "pending") return "waiting";
  return "paused";
}

const STAGE_STATE_COPY: Record<V3StageState, { label: string; color: string }> =
  {
    waiting: { label: "실행 전", color: "ink" },
    running: { label: "실행 중", color: "accent" },
    done: { label: "완료", color: "teal" },
    paused: { label: "일시정지", color: "attention" },
    failed: { label: "실패", color: "red" },
  };

function StageStateBadge({ state }: { state: V3StageState }) {
  const copy = STAGE_STATE_COPY[state];
  return <Badge color={copy.color}>{copy.label}</Badge>;
}

// 산출물 계보. artifact에 실행 시각이 없으므로 리비전·계약·해시만 보여준다.
function Lineage({
  lineage,
  status,
}: {
  lineage: { revision: number; hash?: string; contractVersion?: string };
  status?: string;
}) {
  return (
    <Text size="xs" c="dimmed">
      revision {lineage.revision}
      {status ? ` · ${status}` : ""}
      {lineage.contractVersion ? ` · ${lineage.contractVersion}` : ""}
      {lineage.hash ? ` · ${lineage.hash.slice(0, 15)}…` : ""}
    </Text>
  );
}

function V3PromptStage({
  item,
  evaluations,
}: {
  item: PostWorkItem;
  evaluations: DraftEvaluation[];
}) {
  const artifact = item.pipelineV3?.artifacts.promptBuild;
  return (
    <V3Stage
      item={item}
      evaluations={evaluations}
      stage="image_prompt"
      number="④"
      title="프롬프트"
      description="확정된 이미지 기획과 모델 정책을 컷별 이미지 프롬프트로 변환합니다."
      evaluationKind="prompt"
      evaluationLabel="프롬프트 평가"
      runLabel="이미지 프롬프트"
      lineage={artifact}
    >
      {artifact ? <PromptSetArtifact artifact={artifact} /> : null}
    </V3Stage>
  );
}

function PromptSetArtifact({
  artifact,
}: {
  artifact: NonNullable<
    NonNullable<PostWorkItem["pipelineV3"]>["artifacts"]["promptBuild"]
  >;
}) {
  return (
    <Stack gap="sm">
      <Paper p="md">
        <Stack gap="xs">
          <Meta label="프롬프트">{artifact.shotCount}개</Meta>
          {artifact.targetModelId ? (
            <Meta label="대상 모델">
              {artifact.targetModelId}
              {artifact.policyVersion ? (
                <Text span size="xs" c="dimmed">
                  {" "}
                  · {artifact.policyVersion}
                </Text>
              ) : null}
            </Meta>
          ) : null}
        </Stack>
      </Paper>
      {artifact.shots?.map((shot) => (
        <Paper key={shot.sortOrder} p="md">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              컷 {shot.sortOrder + 1}
            </Text>
            <Code block>{shot.prompt || "프롬프트 없음"}</Code>
            {/* 네거티브는 성격이 반대인 텍스트라 한 덩어리로 붙이지 않는다. */}
            <Text size="xs" c="dimmed">
              네거티브 프롬프트
            </Text>
            {shot.negativePrompt ? (
              <Code block>{shot.negativePrompt}</Code>
            ) : (
              <Text size="xs" c="dimmed">
                {artifact.usesNegativePrompt === false
                  ? "이 모델은 네거티브를 사용하지 않습니다"
                  : "없음"}
              </Text>
            )}
            {shot.slots?.length ? (
              <Stack gap={2}>
                <Text size="xs" c="dimmed">
                  슬롯 바인딩
                </Text>
                {shot.slots.map((slot) => (
                  <Group
                    key={slot.bindingId}
                    gap={6}
                    align="baseline"
                    wrap="nowrap"
                  >
                    <Badge size="xs" variant="light">
                      {slot.slot}
                    </Badge>
                    <Text size="xs">
                      {slot.source} · {slot.referenceId}
                    </Text>
                  </Group>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function StagePaper({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Paper p="lg" component="section" aria-labelledby="stage-title">
      <Stack>
        <Stack gap={2}>
          <Group gap="sm" align="center" wrap="wrap">
            <Title order={4} id="stage-title">
              {title}
            </Title>
            {status}
          </Group>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

function BriefStage({ item, draft }: { item: PostWorkItem; draft: Draft }) {
  const concept = draft.conceptJson ?? {};
  const v3 = item.pipelineV3;
  const planningInput = v3?.artifacts.postPlan?.planningInput;
  const nextStage = v3 ? "post_plan" : "plan";
  return (
    <StagePaper
      title="① 브리프"
      description="게시물 생성의 입력과 실행 출처를 확인합니다."
      status={
        <Badge variant="outline" color={v3 ? "teal" : "ink"}>
          {v3 ? "Agent V3" : "V2 legacy"}
        </Badge>
      }
    >
      <Meta label="캐릭터">
        <CharacterName id={draft.characterId} />
      </Meta>
      <Meta label="콘텐츠 형식">{draft.contentType}</Meta>
      {/* V3는 operatorRequest, V2는 sceneHint에 저장한다. */}
      <Meta label="장면·주제 요청">
        {concept.operatorRequest || concept.sceneHint || "지정 없음"}
      </Meta>
      <Meta label="게시 일정">
        {draft.scheduledAt ? formatDateTime(draft.scheduledAt) : "승인 후 즉시"}
      </Meta>
      <Meta label="진행 정책">
        {concept.mode === "manual"
          ? "단계별 수동 진행"
          : "개입 전까지 자동 진행"}
      </Meta>
      {planningInput ? <PlanningInputSnapshot input={planningInput} /> : null}
      {v3 && !planningInput ? (
        <Alert color="gray">
          게시글 기획을 아직 실행하지 않아 Agent에게 넘긴 입력 스냅숏이
          없습니다.
        </Alert>
      ) : null}
      <Group>
        <Button component={Link} to={`/posts/${item.id}/${nextStage}`}>
          {v3 ? "게시글 기획으로" : "기획으로"}
        </Button>
      </Group>
    </StagePaper>
  );
}

const PERSONA_GROUP_LABEL: Record<string, string> = {
  characterContext: "캐릭터 맥락",
  contentStyle: "콘텐츠 스타일",
  voice: "말투",
  boundaries: "경계",
  additionalContext: "추가 맥락",
};

// Agent가 실제로 본 입력. 기획 결과가 이상할 때 프롬프트를 의심하기 전에
// 입력을 확인할 수 있어야 한다 — 이게 유일한 추적 경로다.
function PlanningInputSnapshot({ input }: { input: V3PlanningInput }) {
  return (
    <Paper p="md" component="section">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Agent가 본 입력
        </Text>
        <Text size="xs" c="dimmed">
          페르소나 블록 {input.persona.length}개 · 메모리{" "}
          {input.memories.length}건 · 최근 게시물 {input.recentPosts.length}건
        </Text>
        <Spoiler maxHeight={0} showLabel="입력 펼치기" hideLabel="접기">
          <Stack gap="sm" mt="xs">
            {input.persona.map((block, index) => (
              <Stack key={`${block.group}:${block.title}:${index}`} gap={2}>
                <Group gap={6} align="baseline">
                  <Badge size="xs" variant="light">
                    {PERSONA_GROUP_LABEL[block.group] ?? block.group}
                  </Badge>
                  <Text size="xs" fw={600}>
                    {block.title}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                  {block.content}
                </Text>
              </Stack>
            ))}
            {input.memories.length ? (
              <Stack gap={2}>
                <Text size="xs" fw={600}>
                  메모리
                </Text>
                {input.memories.map((memory, index) => (
                  <Group key={`${memory.type}:${index}`} gap={6} wrap="nowrap">
                    <Badge size="xs" variant="light">
                      {memory.type}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {memory.content}
                    </Text>
                  </Group>
                ))}
              </Stack>
            ) : null}
            {input.recentPosts.length ? (
              <Stack gap={4}>
                <Text size="xs" fw={600}>
                  최근 게시물
                </Text>
                {input.recentPosts.map((post, index) => (
                  <Stack key={index} gap={0}>
                    {post.premise ? (
                      <Text size="xs" c="dimmed">
                        전제 · {post.premise}
                      </Text>
                    ) : null}
                    <Text size="xs" c="dimmed">
                      {post.caption}
                    </Text>
                    {post.hashtags.length ? (
                      <Text size="xs" c="dimmed">
                        {post.hashtags.map((tag) => `#${tag}`).join(" ")}
                      </Text>
                    ) : null}
                  </Stack>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Spoiler>
      </Stack>
    </Paper>
  );
}

function PlanStage({ draft }: { draft: Draft }) {
  const navigate = useNavigate();
  const concept = draft.conceptJson ?? {};
  const plan = concept.plan;
  const run = useDraftMutation(draft.id, () => runDraftStage(draft.id, "plan"));

  if (!plan) {
    return (
      <StagePaper
        title="② 기획"
        description="페르소나·메모리·최근 게시물을 바탕으로 캡션과 컷을 기획합니다."
      >
        {draft.status === "generating" ? (
          <Group gap="xs" role="status">
            <Loader size="sm" />
            <Text size="sm">기획 Agent 실행 중…</Text>
          </Group>
        ) : (
          <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>
            기획 생성
          </Button>
        )}
        {run.isError ? <MutationError error={run.error} /> : null}
      </StagePaper>
    );
  }

  const editable =
    concept.mode === "manual" &&
    draft.status === "generating" &&
    (draft.shots ?? []).every((shot) => shot.status === "draft");
  return (
    <StagePaper
      title="② 기획"
      description="캡션, 해시태그와 컷별 장면을 검토합니다."
    >
      {editable ? (
        <PlanEditor
          draft={draft}
          onDone={() => void navigate(`/posts/${draft.id}/prompt`)}
        />
      ) : (
        <>
          <DraftPlanSummary concept={concept} />
          <Group>
            <Button onClick={() => void navigate(`/posts/${draft.id}/prompt`)}>
              프롬프트로
            </Button>
          </Group>
        </>
      )}
    </StagePaper>
  );
}

function PlanEditor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const plan = draft.conceptJson?.plan ?? {};
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      caption: draft.caption || plan.caption || "",
      hashtags: (draft.hashtags.length
        ? draft.hashtags
        : (plan.hashtags ?? [])
      ).join(", "),
      shots: (plan.shots ?? []).map((shot, index) => ({
        sortOrder: index,
        scene: shot.scene ?? "",
      })),
    },
    validate: {
      caption: (value) => (value.trim() ? null : "캡션을 입력해 주세요"),
      shots: {
        scene: (value) => (value.trim() ? null : "장면을 입력해 주세요"),
      },
    },
  });
  const save = useDraftMutation(draft.id, (values: typeof form.values) =>
    updateDraftPlan(draft.id, {
      caption: values.caption.trim(),
      hashtags: values.hashtags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      shots: values.shots.map((shot) => ({
        ...shot,
        scene: shot.scene.trim(),
      })),
    }),
  );
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        save.mutate(values, { onSuccess: onDone }),
      )}
    >
      <Stack>
        <Textarea
          label="캡션"
          autosize
          minRows={4}
          key={form.key("caption")}
          {...form.getInputProps("caption")}
        />
        <TextInput
          label="해시태그"
          description="쉼표로 구분"
          key={form.key("hashtags")}
          {...form.getInputProps("hashtags")}
        />
        {form.getValues().shots.map((shot, index) => (
          <Textarea
            key={form.key(`shots.${index}.scene`)}
            label={`컷 ${shot.sortOrder + 1} 장면`}
            autosize
            minRows={2}
            {...form.getInputProps(`shots.${index}.scene`)}
          />
        ))}
        {save.isError ? <MutationError error={save.error} /> : null}
        <Group>
          <Button type="submit" loading={save.isPending}>
            확정하고 프롬프트로
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function PromptStage({ draft }: { draft: Draft }) {
  const navigate = useNavigate();
  const shots = draft.shots ?? [];
  const [selected, setSelected] = useState(0);
  const build = useDraftMutation(draft.id, () =>
    runDraftStage(draft.id, "build-prompts"),
  );
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      items: shots.map((shot) => ({ jobId: shot.jobId, prompt: shot.prompt })),
    },
  });
  const save = useDraftMutation(draft.id, (values: typeof form.values) =>
    updateDraftPrompts(draft.id, {
      items: values.items.map((item) => ({
        ...item,
        prompt: item.prompt.trim(),
      })),
    }),
  );
  const editable =
    shots.length > 0 && shots.every((shot) => shot.status === "draft");
  const current = shots[selected];

  return (
    <StagePaper
      title="③ 프롬프트"
      description="컷을 하나씩 선택해 이미지 모델에 전달할 프롬프트를 검토합니다."
    >
      {shots.length === 0 ? (
        <Alert color="gray">기획을 먼저 완료해 주세요.</Alert>
      ) : (
        <>
          <div className={styles.promptLayout}>
            <Stack gap="xs">
              {shots.map((shot, index) => (
                <Button
                  key={shot.jobId}
                  variant={selected === index ? "filled" : "default"}
                  onClick={() => setSelected(index)}
                  justify="space-between"
                >
                  컷 {shot.sortOrder + 1}
                  <Badge size="xs" color={shot.prompt ? "teal" : "attention"}>
                    {shot.prompt ? "준비됨" : "비어 있음"}
                  </Badge>
                </Button>
              ))}
            </Stack>
            <Stack>
              <Text size="sm" c="dimmed">
                장면 · {current?.scene ?? "—"}
              </Text>
              {editable ? (
                <Textarea
                  label={`컷 ${(current?.sortOrder ?? 0) + 1} 프롬프트`}
                  autosize
                  minRows={10}
                  key={form.key(`items.${selected}.prompt`)}
                  {...form.getInputProps(`items.${selected}.prompt`)}
                />
              ) : (
                <Code block>{current?.prompt || "프롬프트 없음"}</Code>
              )}
            </Stack>
          </div>
          {build.isError ? <MutationError error={build.error} /> : null}
          {save.isError ? <MutationError error={save.error} /> : null}
          <Group>
            {editable ? (
              <Button
                variant="default"
                loading={build.isPending}
                onClick={() => build.mutate(undefined)}
              >
                {shots.some((shot) => !shot.prompt)
                  ? "전체 프롬프트 생성"
                  : "전체 프롬프트 다시 생성"}
              </Button>
            ) : null}
            {editable ? (
              <Button
                loading={save.isPending}
                onClick={() =>
                  save.mutate(form.getValues(), {
                    onSuccess: () =>
                      void navigate(`/posts/${draft.id}/evaluation`),
                  })
                }
              >
                확정하고 평가로
              </Button>
            ) : (
              <Button
                onClick={() => void navigate(`/posts/${draft.id}/evaluation`)}
              >
                평가로
              </Button>
            )}
          </Group>
        </>
      )}
    </StagePaper>
  );
}

function EvaluationStage({
  draft,
  evaluations,
}: {
  draft: Draft;
  evaluations: DraftEvaluation[];
}) {
  const plan = latestEvaluation(evaluations, "plan");
  const prompt = latestEvaluation(evaluations, "prompt");
  return (
    <StagePaper
      title="④ 평가"
      description="기획과 프롬프트의 품질 신호입니다. 평가가 늦거나 실패해도 다음 단계는 막지 않습니다."
    >
      {!plan && !prompt ? (
        <Alert color="gray">
          아직 평가 결과가 없습니다. 평가 워커가 꺼져 있어도 이미지 생성을
          계속할 수 있습니다. 켜거나 지금 한 건만 돌리려면{" "}
          <Anchor component={Link} to="/settings">
            설정 &gt; 평가 워커
          </Anchor>
          로 가세요.
        </Alert>
      ) : null}
      <EvaluationBlock label="기획 평가" evaluation={plan} />
      <EvaluationBlock label="프롬프트 평가" evaluation={prompt} />
      <Group>
        <Button component={Link} to={`/posts/${draft.id}/generation`}>
          이미지 생성으로
        </Button>
      </Group>
    </StagePaper>
  );
}

function EvaluationBlock({
  label,
  evaluation,
}: {
  label: string;
  evaluation?: DraftEvaluation;
}) {
  // 평가 행이 없는 것과 대기 중인 것과 실패한 것은 운영자에게 서로 다른 상황이다.
  // 아무것도 렌더하지 않으면 셋을 구분할 수 없다.
  if (!evaluation) {
    return (
      <Paper p="md" component="section">
        <Stack gap="xs">
          <Text fw={600}>{label}</Text>
          <Text size="sm" c="dimmed">
            아직 평가 결과가 없습니다. 평가는 비차단 신호라 꺼져 있어도 다음
            단계를 진행할 수 있습니다. 켜거나 지금 한 건만 돌리려면{" "}
            <Anchor component={Link} to="/settings">
              설정 &gt; 평가 워커
            </Anchor>
            로 가세요.
          </Text>
        </Stack>
      </Paper>
    );
  }
  return (
    <Paper p="md" component="section">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{label}</Text>
          <Text size="xs" c="dimmed">
            시도 {evaluation.attempt}
            {evaluationDuration(evaluation)}
            {evaluation.evaluatorName ? ` · ${evaluation.evaluatorName}` : ""}
          </Text>
        </Group>
        {evaluation.status === "pending" ? (
          <Group gap="xs" role="status">
            <Loader size="xs" />
            <Text size="sm">평가 대기 중…</Text>
          </Group>
        ) : null}
        <EvaluationChips evaluation={evaluation} />
        {evaluation.errorMessage ? (
          <Alert color="red" title="평가 실패">
            {evaluation.errorMessage}
          </Alert>
        ) : null}
        {evaluation.issuesJson || evaluation.suggestionsJson ? (
          <Spoiler
            maxHeight={0}
            showLabel="지적·제안 원문 보기"
            hideLabel="접기"
          >
            <Code block>
              {JSON.stringify(
                {
                  issues: evaluation.issuesJson,
                  suggestions: evaluation.suggestionsJson,
                },
                null,
                2,
              )}
            </Code>
          </Spoiler>
        ) : null}
      </Stack>
    </Paper>
  );
}

function GenerationStage({
  item,
  draft,
  evaluations,
}: {
  item: PostWorkItem;
  draft: Draft;
  evaluations: DraftEvaluation[];
}) {
  const navigate = useNavigate();
  const shots = draft.shots ?? [];
  const evaluation = latestEvaluation(evaluations, "prompt");
  const imageEvaluation = latestEvaluation(evaluations, "image");
  const aggregate = useDraftMutation(draft.id, () =>
    runDraftStage(draft.id, "aggregate"),
  );
  const completed = shots.filter((shot) => shot.status === "completed").length;
  const failed = shots.filter((shot) => shot.status === "failed").length;
  const running = shots.filter(
    (shot) => shot.status === "queued" || shot.status === "running",
  ).length;
  const allCompleted = shots.length > 0 && completed === shots.length;
  return (
    <StagePaper
      title="⑤ 이미지 생성"
      description="컷별 실행 상태, 모델 경로와 생성 후보를 확인합니다."
      {...(item.pipelineV3
        ? {
            status: (
              <StageStateBadge
                state={v3StageState(item.pipelineV3, "generation")}
              />
            ),
          }
        : {})}
    >
      {shots.length === 0 ? (
        <Alert color="gray">프롬프트를 먼저 준비해 주세요.</Alert>
      ) : (
        // 이 단계는 유일하게 시간에 따라 변한다. 컷 카드를 다 훑지 않고도
        // 어디까지 왔는지 한 줄로 알 수 있어야 한다.
        <Group gap="xs" wrap="wrap" role="status">
          <Badge color={allCompleted ? "teal" : "ink"}>
            완료 {completed}/{shots.length}
          </Badge>
          {running > 0 ? <Badge color="accent">생성 중 {running}</Badge> : null}
          {failed > 0 ? <Badge color="red">실패 {failed}</Badge> : null}
        </Group>
      )}
      {shots.map((shot) => (
        <ShotCard
          key={shot.jobId}
          draft={draft}
          shot={shot}
          evaluation={evaluation}
          imageEvaluation={imageEvaluation}
        />
      ))}
      {aggregate.isError ? <MutationError error={aggregate.error} /> : null}
      {allCompleted &&
      (draft.status === "generating" || draft.status === "regenerating") ? (
        <Group>
          <Button
            loading={aggregate.isPending}
            onClick={() =>
              aggregate.mutate(undefined, {
                onSuccess: () => void navigate(`/posts/${draft.id}/review`),
              })
            }
          >
            검수로 보내기
          </Button>
        </Group>
      ) : null}
    </StagePaper>
  );
}

function ReviewStage({
  item,
  draft,
  evaluations,
}: {
  item: PostWorkItem;
  draft: Draft;
  evaluations: DraftEvaluation[];
}) {
  const shots = draft.shots ?? [];
  const promptEvaluation = latestEvaluation(evaluations, "prompt");
  const imageEvaluation = latestEvaluation(evaluations, "image");
  const approve = useDraftMutation(draft.id, () =>
    runDraftStage(draft.id, "approve"),
  );
  const selected = shots.filter((shot) =>
    shot.outputs.some((output) => output.selected),
  ).length;
  const ready = shots.length > 0 && selected === shots.length;
  const plannedShots = item.pipelineV3?.artifacts.imagePlan?.shots;
  return (
    <StagePaper
      title="⑥ 검수"
      description="게시 후보, 캡션과 일정을 확인하고 승인 또는 반려합니다."
      {...(item.pipelineV3
        ? {
            status: (
              <StageStateBadge
                state={v3StageState(item.pipelineV3, "review")}
              />
            ),
          }
        : {})}
    >
      <EvaluationChips evaluation={promptEvaluation} />
      <EvaluationChips evaluation={imageEvaluation} />
      {draft.status === "needs_review" && !ready ? (
        <Alert color="attention">
          게시 이미지 {selected}/{shots.length} 선택 · 컷마다 한 장을 선택해
          주세요.
        </Alert>
      ) : null}
      {shots.map((shot) => {
        // 검수는 "기획한 대로 나왔는가"를 판단하는 자리다. 기획 원문이 없으면
        // 화면을 떠나 ③으로 갔다 와야 한다.
        const planned = plannedShots?.find(
          (entry) => entry.sortOrder === shot.sortOrder,
        );
        return (
          <ShotCard
            key={shot.jobId}
            draft={draft}
            shot={shot}
            evaluation={promptEvaluation}
            imageEvaluation={imageEvaluation}
            {...(planned ? { planned } : {})}
          />
        );
      })}
      {draft.status === "needs_review" || draft.status === "approved" ? (
        <ReviewEditForm draft={draft} />
      ) : null}
      {draft.status === "needs_review" ? (
        <>
          {approve.isError ? <MutationError error={approve.error} /> : null}
          <Group align="flex-end">
            <Button
              disabled={!ready}
              loading={approve.isPending}
              onClick={() => approve.mutate(undefined)}
            >
              승인
            </Button>
            <RejectForm draft={draft} />
          </Group>
        </>
      ) : (
        <Alert color={draft.status === "rejected" ? "red" : "gray"}>
          {draft.status === "rejected"
            ? "반려된 게시물입니다."
            : "현재 상태에서는 검수 결정을 변경할 수 없습니다."}
        </Alert>
      )}
    </StagePaper>
  );
}

function ReviewEditForm({ draft }: { draft: Draft }) {
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
      scheduledAt: values.scheduledAt
        ? new Date(values.scheduledAt).toISOString()
        : null,
    }),
  );
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack>
        <Textarea
          label="캡션"
          autosize
          minRows={4}
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
          label="게시 일정"
          type="datetime-local"
          w={280}
          key={form.key("scheduledAt")}
          {...form.getInputProps("scheduledAt")}
        />
        {save.isError ? <MutationError error={save.error} /> : null}
        <Group>
          <Button type="submit" variant="default" loading={save.isPending}>
            검수 내용 저장
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function RejectForm({ draft }: { draft: Draft }) {
  const form = useForm({ mode: "uncontrolled", initialValues: { reason: "" } });
  const reject = useDraftMutation(draft.id, (values: { reason: string }) =>
    rejectDraft(draft.id, values.reason.trim() || undefined),
  );
  return (
    <form onSubmit={form.onSubmit((values) => reject.mutate(values))}>
      <Group align="flex-end" gap="xs">
        <TextInput
          label="반려 사유"
          placeholder="선택"
          key={form.key("reason")}
          {...form.getInputProps("reason")}
        />
        <Button type="submit" variant="default" loading={reject.isPending}>
          반려
        </Button>
      </Group>
      {reject.isError ? <MutationError error={reject.error} /> : null}
    </form>
  );
}

function PublishStage({
  item,
  draft,
  post,
}: {
  item: PostWorkItem;
  draft?: Draft;
  post?: PostListItem;
}) {
  const publish = useDraftMutation(draft?.id ?? "", () =>
    runDraftStage(draft!.id, "publish"),
  );
  const [interaction, setInteraction] = useState<PostInteraction | null>(null);
  return (
    <StagePaper
      title="⑦ 게시"
      description="게시 대기 상태와 실제 게시 결과를 확인합니다."
      {...(item.pipelineV3
        ? {
            status: (
              <StageStateBadge
                state={v3StageState(item.pipelineV3, "publish")}
              />
            ),
          }
        : {})}
    >
      {/* 게시 전에도 실제로 나갈 모습을 봐야 결정할 수 있다. 게시 후에는
          post가 정본이므로 미리보기를 대체한다. */}
      {!post && draft ? <PublishPreview draft={draft} /> : null}
      {draft?.status === "approved" ? (
        <>
          <Alert color="blue">
            예정 시각과 무관하게 지금 게시할 수 있습니다.
          </Alert>
          {publish.isError ? <MutationError error={publish.error} /> : null}
          <Group>
            <Button
              loading={publish.isPending}
              onClick={() => publish.mutate(undefined)}
            >
              지금 게시
            </Button>
          </Group>
        </>
      ) : null}
      {post ? (
        <>
          <Text style={{ whiteSpace: "pre-wrap" }}>{post.content}</Text>
          <Group gap="xs">
            {post.hashtags.map((tag) => (
              <Badge key={tag} variant="light">
                #{tag}
              </Badge>
            ))}
          </Group>
          <div className={styles.mediaGrid}>
            {post.media.map((media, index) => (
              <ZoomableImage
                key={`${media.url}:${index}`}
                src={media.url}
                alt={`게시물 미디어 ${index + 1}`}
                className={styles.media}
                fit="contain"
              />
            ))}
          </div>
          {/* 영수증 — 무엇이 언제 어떤 id로 나갔는지. */}
          <Text size="xs" c="dimmed">
            게시 {formatDateTime(post.createdAt)} · post {post.id}
            {item.scheduledAt
              ? ` · 예약 ${formatDateTime(item.scheduledAt)}`
              : " · 예약 없음"}
          </Text>
          <Group>
            <Text size="sm">
              댓글 {post.commentCount} · 반응 {post.reactionCount}
            </Text>
            <Button
              variant="default"
              size="compact-sm"
              onClick={() =>
                setInteraction({ postId: post.id, mode: "comment" })
              }
            >
              댓글 추가
            </Button>
            <Button
              variant="default"
              size="compact-sm"
              onClick={() =>
                setInteraction({ postId: post.id, mode: "reaction" })
              }
            >
              반응 추가
            </Button>
          </Group>
          <PostInteractionModal
            interaction={interaction}
            onClose={() => setInteraction(null)}
          />
        </>
      ) : draft?.status !== "approved" ? (
        <Alert color="gray">승인 후 게시할 수 있습니다.</Alert>
      ) : null}
      {item.postId && !post ? (
        <Text size="sm" c="dimmed">
          게시 결과를 불러오는 중…
        </Text>
      ) : null}
    </StagePaper>
  );
}

// 게시 전 미리보기. 검수에서 고른 컷과 편집한 캡션이 실제로 어떤 조합으로
// 나가는지는 여기서만 한 번에 보인다.
function PublishPreview({ draft }: { draft: Draft }) {
  const selected = (draft.shots ?? []).flatMap((shot) =>
    shot.outputs
      .filter((output) => output.selected)
      .map((output) => ({ ...output, sortOrder: shot.sortOrder })),
  );
  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Text fw={600} size="sm">
          게시 미리보기
        </Text>
        {selected.length === 0 ? (
          <Alert color="gray">아직 선택된 게시 이미지가 없습니다.</Alert>
        ) : (
          <div className={styles.mediaGrid}>
            {selected.map((output) => (
              <ZoomableImage
                key={output.mediaId}
                src={output.url}
                alt={`게시 예정 이미지 ${output.sortOrder + 1}`}
                className={styles.media}
                fit="contain"
              />
            ))}
          </div>
        )}
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {draft.caption || "캡션 없음"}
        </Text>
        {draft.hashtags.length ? (
          <Group gap="xs" wrap="wrap">
            {draft.hashtags.map((tag) => (
              <Badge key={tag} variant="light">
                #{tag}
              </Badge>
            ))}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}

function MemoryStage({ item, draft }: { item: PostWorkItem; draft?: Draft }) {
  const candidates = item.pipelineV3?.memoryCandidates;
  const published = draft?.status === "published";
  return (
    <StagePaper
      title="⑧ 메모리"
      description="게시 결과가 다음 기획에 어떤 기억으로 이어지는지 확인합니다."
      {...(item.pipelineV3
        ? {
            status: (
              <StageStateBadge
                state={v3StageState(item.pipelineV3, "memory")}
              />
            ),
          }
        : {})}
    >
      {candidates ? (
        <MemoryCandidateList candidates={candidates} published={published} />
      ) : null}
      {published && candidates ? (
        <Text size="xs" c="dimmed">
          현재 스키마에는 메모리와 draft의 직접 FK가 없어 게시 시점의 후보
          판정으로 표시합니다.
        </Text>
      ) : null}
      {draft?.status === "published" && !candidates ? (
        <>
          <Alert color="teal">
            게시 트랜잭션에서 캐릭터 메모리에 반영되었습니다.
          </Alert>
          <Paper p="md">
            <Text>{draft.caption}</Text>
          </Paper>
          <Text size="xs" c="dimmed">
            현재 스키마에는 메모리와 draft의 직접 FK가 없어 게시 시 기록된
            본문을 영수증으로 표시합니다.
          </Text>
        </>
      ) : item.kind === "post" ? (
        <Alert color="gray">
          생성 파이프라인 밖에서 직접 작성된 게시물이라 연결된 메모리 기록이
          없습니다.
        </Alert>
      ) : candidates ? null : (
        <Alert color="gray">
          게시가 완료되면 메모리 반영 결과가 표시됩니다.
        </Alert>
      )}
    </StagePaper>
  );
}

// 후보 판정은 게시 트랜잭션이 실제로 거르는 규칙과 같아야 한다
// (`selectedPublishedMemories`: selected && sourcePostPlanHash === 현재 해시).
// 화면이 저장되지 않은 기억을 저장됐다고 말하면 다음 기획 판단이 통째로
// 어긋난다.
function memoryCandidateVerdict(
  candidate: V3MemoryCandidate,
  published: boolean,
): { label: string; color: string; detail?: string } {
  if (candidate.stale) {
    return {
      label: "무효",
      color: "ink",
      detail: "기획을 다시 실행해 이 후보는 더 이상 저장 대상이 아닙니다.",
    };
  }
  if (!candidate.selected) {
    return {
      label: "제외됨",
      color: "ink",
      detail: "게시해도 저장되지 않습니다.",
    };
  }
  return published
    ? { label: "저장됨", color: "teal" }
    : { label: "선택됨", color: "accent", detail: "게시 시 저장됩니다." };
}

function MemoryCandidateList({
  candidates,
  published,
}: {
  candidates: V3MemoryCandidate[];
  published: boolean;
}) {
  if (candidates.length === 0) {
    return (
      <Alert color="gray">
        이 게시물은 캐릭터 세계관에 새 기억을 남기지 않습니다.
      </Alert>
    );
  }
  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Text fw={600} size="sm">
          기억 후보 {candidates.length}건
        </Text>
        {candidates.map((candidate, index) => {
          const verdict = memoryCandidateVerdict(candidate, published);
          return (
            <Stack key={`${candidate.type}:${index}`} gap={2}>
              <Group gap="xs" align="baseline" wrap="wrap">
                <Badge size="xs" color={verdict.color}>
                  {verdict.label}
                </Badge>
                <Badge size="xs" variant="light">
                  {candidate.type}
                </Badge>
                <Text size="sm">{candidate.content}</Text>
              </Group>
              {verdict.detail ? (
                <Text size="xs" c="dimmed">
                  {verdict.detail}
                </Text>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

function UnavailableStage({ stage }: { stage: PostWorkStage }) {
  const stages = [...V3_STAGES, ...LEGACY_STAGES];
  const definition = stages.find((item) => item.id === stage)!;
  const index = (
    V3_STAGES.some((item) => item.id === stage) ? V3_STAGES : LEGACY_STAGES
  ).findIndex((item) => item.id === stage);
  return (
    <StagePaper
      title={`${STAGE_NUMBER[index]} ${definition.label}`}
      description="직접 작성된 게시물에는 생성 Agent 단계 이력이 없습니다."
    >
      <Alert color="gray">이 단계는 건너뛰었습니다.</Alert>
    </StagePaper>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Group gap="sm" align="baseline">
      <Text size="xs" c="dimmed" w={120}>
        {label}
      </Text>
      <Text component="div" size="sm">
        {children}
      </Text>
    </Group>
  );
}

function MutationError({ error }: { error: Error }) {
  return (
    <Alert color="red" role="alert" title="처리하지 못했습니다">
      {error.message}
    </Alert>
  );
}

// 평가에는 artifact와 달리 실제 시각이 있다. 얼마나 걸렸는지가 "돌긴 돌았나"를
// 판단하는 가장 싼 신호다.
function evaluationDuration(evaluation: DraftEvaluation) {
  if (!evaluation.completedAt) return "";
  const seconds = Math.round(
    (new Date(evaluation.completedAt).getTime() -
      new Date(evaluation.createdAt).getTime()) /
      1000,
  );
  return seconds >= 0 ? ` · ${seconds}초` : "";
}

function latestEvaluation(
  evaluations: DraftEvaluation[],
  kind: DraftEvaluation["kind"],
) {
  return evaluations
    .filter((evaluation) => evaluation.kind === kind)
    .sort((left, right) => right.attempt - left.attempt)[0];
}

function isStage(value: string): value is PostWorkStage {
  return [...V3_STAGES, ...LEGACY_STAGES].some((stage) => stage.id === value);
}

function sourceLabel(source: PostWorkItem["source"]) {
  if (source === "scheduler") return "자동화 생성";
  if (source === "manual") return "게시물 만들기";
  if (source === "direct") return "직접 게시";
  return "출처 미상";
}

function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
