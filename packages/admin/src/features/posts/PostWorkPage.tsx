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
const V3_STAGES: { id: PostWorkStage; label: string }[] = [
  { id: "brief", label: "브리프" },
  { id: "post_plan", label: "게시글 기획" },
  { id: "image_plan", label: "이미지 기획" },
  { id: "prompt", label: "프롬프트" },
  { id: "generation", label: "이미지 생성" },
  { id: "review", label: "검수" },
  { id: "publish", label: "게시" },
  { id: "memory", label: "메모리" },
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
        return (
          <Link
            key={stage.id}
            className={`${styles.stageLink} ${active ? styles.active : ""} ${done && !skipped ? styles.done : ""}`}
            to={`/posts/${encodeURIComponent(item.id)}/${stage.id}`}
            aria-current={active ? "step" : undefined}
          >
            <Stack gap={0}>
              <Text size="sm" fw={600}>
                {STAGE_NUMBER[index]} {stage.label}
              </Text>
              <Text size="xs" c="dimmed">
                {active
                  ? "현재 화면"
                  : skipped
                    ? "건너뜀"
                    : done
                      ? "완료"
                      : "대기"}
              </Text>
            </Stack>
          </Link>
        );
      })}
    </nav>
  );
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
  if (stage === "brief") return <BriefStage draft={draft!} />;
  if (stage === "post_plan") {
    return (
      <V3ArtifactStage item={item} evaluations={evaluations} kind="post_plan" />
    );
  }
  if (stage === "image_plan") {
    return (
      <V3ArtifactStage
        item={item}
        evaluations={evaluations}
        kind="image_plan"
      />
    );
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
    return <GenerationStage draft={draft!} evaluations={evaluations} />;
  }
  if (stage === "review") {
    return <ReviewStage draft={draft!} evaluations={evaluations} />;
  }
  if (stage === "publish") {
    return <PublishStage item={item} draft={draft} post={post} />;
  }
  return <MemoryStage item={item} draft={draft} />;
}

function V3ArtifactStage({
  item,
  evaluations,
  kind,
}: {
  item: PostWorkItem;
  evaluations: DraftEvaluation[];
  kind: "post_plan" | "image_plan";
}) {
  const pipeline = item.pipelineV3;
  const isPostPlan = kind === "post_plan";
  const artifact = isPostPlan
    ? pipeline?.artifacts.postPlan
    : pipeline?.artifacts.imagePlan;
  const evaluation = latestEvaluation(
    evaluations,
    isPostPlan ? "plan" : "image_plan",
  );
  const run = useDraftMutation(item.draftId ?? "", () =>
    runDraftStage(item.draftId!, "plan"),
  );
  const runnable =
    Boolean(item.draftId) &&
    pipeline?.state === "pending" &&
    pipeline.stage === kind;
  return (
    <StagePaper
      title={`${isPostPlan ? "②" : "③"} ${isPostPlan ? "게시글 기획" : "이미지 기획"}`}
      description={
        isPostPlan
          ? "캐릭터 맥락을 바탕으로 게시글 의도와 문안을 확정합니다."
          : "확정된 게시글을 몇 장의 이미지로 보여줄지 구성합니다."
      }
    >
      {artifact ? (
        <Paper p="md">
          <Stack gap="xs">
            <Meta label="산출물">
              revision {artifact.revision} · {artifact.status}
            </Meta>
            {isPostPlan && "premise" in artifact && artifact.premise ? (
              <Meta label="전제">{artifact.premise}</Meta>
            ) : null}
            {!isPostPlan && "shotCount" in artifact ? (
              <Meta label="이미지 장수">
                {artifact.shotCount ?? pipeline?.imageCount ?? "—"}장
              </Meta>
            ) : null}
          </Stack>
        </Paper>
      ) : (
        <Alert color="gray">아직 이 단계의 산출물이 없습니다.</Alert>
      )}
      <EvaluationBlock
        label={`${isPostPlan ? "게시글" : "이미지 기획"} 평가`}
        evaluation={evaluation}
      />
      {pipeline ? (
        <Alert color="blue">다음 행동 · {pipeline.nextAction}</Alert>
      ) : null}
      {run.isError ? <MutationError error={run.error} /> : null}
      {runnable ? (
        <Group>
          <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>
            {isPostPlan ? "게시글 기획 실행" : "이미지 기획 실행"}
          </Button>
        </Group>
      ) : null}
    </StagePaper>
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
  const evaluation = latestEvaluation(evaluations, "prompt");
  const run = useDraftMutation(item.draftId ?? "", () =>
    runDraftStage(item.draftId!, "plan"),
  );
  const runnable =
    Boolean(item.draftId) &&
    item.pipelineV3?.state === "pending" &&
    item.pipelineV3.stage === "image_prompt";
  return (
    <StagePaper
      title="④ 프롬프트"
      description="확정된 이미지 기획과 모델 정책을 컷별 이미지 프롬프트로 변환합니다."
    >
      {artifact ? (
        <Paper p="md">
          <Stack gap="xs">
            <Meta label="산출물">revision {artifact.revision}</Meta>
            <Meta label="프롬프트">{artifact.shotCount}개</Meta>
            {artifact.targetModelId ? (
              <Meta label="대상 모델">{artifact.targetModelId}</Meta>
            ) : null}
          </Stack>
        </Paper>
      ) : (
        <Alert color="gray">아직 프롬프트 산출물이 없습니다.</Alert>
      )}
      <EvaluationBlock label="프롬프트 평가" evaluation={evaluation} />
      {item.pipelineV3 ? (
        <Alert color="blue">다음 행동 · {item.pipelineV3.nextAction}</Alert>
      ) : null}
      {run.isError ? <MutationError error={run.error} /> : null}
      {runnable ? (
        <Group>
          <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>
            이미지 프롬프트 생성
          </Button>
        </Group>
      ) : null}
    </StagePaper>
  );
}

function StagePaper({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Paper p="lg" component="section" aria-labelledby="stage-title">
      <Stack>
        <Stack gap={2}>
          <Title order={4} id="stage-title">
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

function BriefStage({ draft }: { draft: Draft }) {
  const concept = draft.conceptJson ?? {};
  return (
    <StagePaper
      title="① 브리프"
      description="게시물 생성의 입력과 실행 출처를 확인합니다."
    >
      <Meta label="캐릭터">
        <CharacterName id={draft.characterId} />
      </Meta>
      <Meta label="콘텐츠 형식">{draft.contentType}</Meta>
      <Meta label="장면·주제 요청">{concept.sceneHint || "지정 없음"}</Meta>
      <Meta label="게시 일정">
        {draft.scheduledAt ? formatDateTime(draft.scheduledAt) : "승인 후 즉시"}
      </Meta>
      <Meta label="진행 정책">
        {concept.mode === "manual"
          ? "단계별 수동 진행"
          : "개입 전까지 자동 진행"}
      </Meta>
      <Group>
        <Button component={Link} to={`/posts/${draft.id}/plan`}>
          기획으로
        </Button>
      </Group>
    </StagePaper>
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
  if (!evaluation) return null;
  return (
    <Paper p="md" component="section">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{label}</Text>
          <Text size="xs" c="dimmed">
            시도 {evaluation.attempt}
          </Text>
        </Group>
        <EvaluationChips evaluation={evaluation} />
        {evaluation.errorMessage ? (
          <Alert color="red">{evaluation.errorMessage}</Alert>
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
  draft,
  evaluations,
}: {
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
  const allCompleted =
    shots.length > 0 && shots.every((shot) => shot.status === "completed");
  return (
    <StagePaper
      title="⑤ 이미지 생성"
      description="컷별 실행 상태, 모델 경로와 생성 후보를 확인합니다."
    >
      {shots.length === 0 ? (
        <Alert color="gray">프롬프트를 먼저 준비해 주세요.</Alert>
      ) : null}
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
  draft,
  evaluations,
}: {
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
  return (
    <StagePaper
      title="⑥ 검수"
      description="게시 후보, 캡션과 일정을 확인하고 승인 또는 반려합니다."
    >
      <EvaluationChips evaluation={promptEvaluation} />
      <EvaluationChips evaluation={imageEvaluation} />
      {draft.status === "needs_review" && !ready ? (
        <Alert color="attention">
          게시 이미지 {selected}/{shots.length} 선택 · 컷마다 한 장을 선택해
          주세요.
        </Alert>
      ) : null}
      {shots.map((shot) => (
        <ShotCard
          key={shot.jobId}
          draft={draft}
          shot={shot}
          evaluation={promptEvaluation}
          imageEvaluation={imageEvaluation}
        />
      ))}
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
    >
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
          <Text>{post.content}</Text>
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

function MemoryStage({ item, draft }: { item: PostWorkItem; draft?: Draft }) {
  return (
    <StagePaper
      title="⑧ 메모리"
      description="게시 결과가 다음 기획에 어떤 기억으로 이어지는지 확인합니다."
    >
      {draft?.status === "published" ? (
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
      ) : (
        <Alert color="gray">
          게시가 완료되면 메모리 반영 결과가 표시됩니다.
        </Alert>
      )}
    </StagePaper>
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
