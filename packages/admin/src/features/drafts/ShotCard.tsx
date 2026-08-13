import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  SimpleGrid,
  Spoiler,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import type { V3ImagePlanShot } from "../posts/api";
import { CandidateCard } from "./CandidateCard";
import { EvaluationChips } from "./EvaluationChips";
import {
  generateShot,
  regenerateShot,
  type Draft,
  type DraftEvaluation,
  type DraftReference,
  type DraftShot,
  type GenerationTrace,
} from "./api";
import { SHOT_STATUS_COLOR, SHOT_STATUS_LABEL } from "./labels";
import { useDraftMutation } from "./useDraftMutation";

export function ShotCard({
  draft,
  shot,
  evaluation,
  imageEvaluation,
  planned,
}: {
  draft: Draft;
  shot: DraftShot;
  evaluation?: DraftEvaluation;
  imageEvaluation?: DraftEvaluation;
  // V3 이미지 기획의 컷 원문. 검수에서 "기획한 대로 나왔는가"를 화면을 떠나지
  // 않고 대조하기 위한 것이라 생성 단계에서는 넘기지 않는다.
  planned?: V3ImagePlanShot;
}) {
  const canRegenerate =
    draft.status === "needs_review" || draft.status === "failed";

  const regenerate = useDraftMutation(draft.id, () =>
    regenerateShot(draft.id, shot.jobId),
  );

  return (
    <Card padding="md">
      <Stack gap="sm">
        <Group gap="xs" align="center" wrap="wrap">
          <Text fw={600}>컷 {shot.sortOrder + 1}</Text>
          <Badge color={SHOT_STATUS_COLOR[shot.status] ?? "gray"}>
            {SHOT_STATUS_LABEL[shot.status] ?? shot.status}
          </Badge>
          {shot.provider ? (
            <Text size="xs" c="dimmed">
              {shot.provider}
            </Text>
          ) : null}
          {shot.costUsd ? (
            <Text size="xs" c="dimmed">
              ${shot.costUsd}
            </Text>
          ) : null}
          {/* 실행이 실제로 돌았는지 판단하는 가장 싼 신호. 시도 1회에 0초면
              큐에 걸린 것이고, 여러 번 시도했으면 불안정한 컷이다. */}
          <Text size="xs" c="dimmed">
            {shotExecutionLabel(shot)}
          </Text>
        </Group>

        {shot.scene ? (
          <Text size="sm" c="dimmed">
            장면 · {shot.scene}
          </Text>
        ) : null}

        {planned ? <PlannedShotPanel planned={planned} /> : null}

        <EvaluationChips
          evaluation={evaluation}
          shotSortOrder={shot.sortOrder}
        />
        {/* V3 생성 이미지 평가는 컷의 선택된 한 장을 본다 — 후보가 아니라 컷
            단위 자리에 붙인다. V2 이미지 평가는 컷 단위 점수가 없어 아무것도
            렌더하지 않는다. */}
        <EvaluationChips
          evaluation={imageEvaluation}
          shotSortOrder={shot.sortOrder}
        />

        {shot.generationTrace ? (
          <GenerationTracePanel trace={shot.generationTrace} />
        ) : shot.references?.length ? (
          <Stack gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase">
              선별 레퍼런스 {shot.references.length}장 — 기획 LLM이 장면에 맞게
              골랐습니다
            </Text>
            <Group gap={6}>
              {shot.references.map((reference) => (
                <ZoomableImage
                  key={reference.mediaId}
                  src={reference.url}
                  alt="레퍼런스"
                  w={52}
                  h={52}
                  fit="cover"
                />
              ))}
            </Group>
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            이전 버전 작업 · 생성 실행 상세 기록 없음
          </Text>
        )}

        <ShotBody draft={draft} shot={shot} imageEvaluation={imageEvaluation} />

        {canRegenerate && shot.status !== "draft" ? (
          <Group>
            <Button
              variant="subtle"
              size="compact-sm"
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              재생성
            </Button>
          </Group>
        ) : null}
        {regenerate.isError ? (
          <Text size="xs" c="red" role="alert">
            {regenerate.error.message}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

// 시도 횟수와 소요 시간. 종료되지 않은 잡의 "지금까지"는 소요 시간이 아니므로
// 서버가 settledAt을 내리지 않고, 여기서도 표시하지 않는다.
function shotExecutionLabel(shot: DraftShot): string {
  const parts: string[] = [];
  if (shot.attemptCount != null && shot.attemptCount > 0) {
    parts.push(`시도 ${shot.attemptCount}`);
  }
  if (shot.startedAt && shot.settledAt) {
    const seconds = Math.round(
      (new Date(shot.settledAt).getTime() -
        new Date(shot.startedAt).getTime()) /
        1000,
    );
    if (seconds >= 0) parts.push(`${seconds}초`);
  }
  return parts.join(" · ");
}

// 기획 원문. 검수자가 픽셀과 계약을 나란히 놓고 볼 수 있어야 한다. 프레임 안
// (scene)과 프레임 밖(captureSetup)은 여기서도 갈라 놓는다.
function PlannedShotPanel({ planned }: { planned: V3ImagePlanShot }) {
  return (
    <Spoiler maxHeight={0} showLabel="기획 원문 보기" hideLabel="접기">
      <Stack gap={4} mt={4}>
        {planned.visualPurpose ? (
          <Text size="xs" c="dimmed">
            이 컷의 역할 · {planned.visualPurpose}
          </Text>
        ) : null}
        {planned.scene ? (
          <Text size="xs" c="dimmed">
            기획 장면 · {planned.scene}
          </Text>
        ) : null}
        {planned.captureSetup ? (
          <Text size="xs" c="dimmed">
            기획 촬영 · {planned.captureSetup}
          </Text>
        ) : null}
        {planned.presentation ? (
          <Text size="xs" c="dimmed">
            인물 노출 · {planned.presentation.mode}
            {planned.presentation.faceVisible ? " · 얼굴 노출" : ""}
            {planned.presentation.visibleParts.length
              ? ` · ${planned.presentation.visibleParts.join(", ")}`
              : ""}
          </Text>
        ) : null}
      </Stack>
    </Spoiler>
  );
}

function routeLabel(route?: "t2i" | "edit") {
  if (route === "edit") return "레퍼런스 편집";
  if (route === "t2i") return "텍스트 생성";
  return "기록 없음";
}

function ReferenceList({
  label,
  references,
}: {
  label: string;
  references: DraftReference[];
}) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {label} · {references.length}장
      </Text>
      {references.length > 0 ? (
        <Group gap={6}>
          {references.map((reference) =>
            reference.url ? (
              <ZoomableImage
                key={reference.mediaId}
                src={reference.url}
                alt={`${label} ${reference.mediaId}`}
                w={52}
                h={52}
                fit="cover"
              />
            ) : (
              <Stack key={reference.mediaId} gap={2}>
                <Badge variant="light" color="gray">
                  사용 불가
                </Badge>
                <Text size="xs" c="dimmed">
                  {reference.mediaId}
                </Text>
              </Stack>
            ),
          )}
        </Group>
      ) : null}
    </Stack>
  );
}

function GenerationTracePanel({ trace }: { trace: GenerationTrace }) {
  return (
    <Stack gap={6}>
      {trace.matchesPlan === false ? (
        <Alert color="yellow" title="기획과 실제 생성 조건이 다릅니다">
          검수 참고용 경고이며 승인 가능 여부에는 영향을 주지 않습니다.
        </Alert>
      ) : null}

      <Group gap="md" align="flex-start" wrap="wrap">
        <Stack gap={2}>
          <Text size="xs" fw={600}>
            기획
          </Text>
          <Text size="xs" c="dimmed">
            라우트 · {routeLabel(trace.planned.route)}
          </Text>
          <Text size="xs" c="dimmed">
            모델 · {trace.planned.targetModelId ?? "기록 없음"}
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text size="xs" fw={600}>
            실제 실행
          </Text>
          {trace.execution ? (
            <>
              <Text size="xs" c="dimmed">
                라우트 · {routeLabel(trace.execution.route)}
              </Text>
              <Text size="xs" c="dimmed">
                모델 · {trace.execution.provider ?? "기록 없음"}
              </Text>
            </>
          ) : (
            <Text size="xs" c="dimmed">
              아직 provider에 제출되지 않았거나 이전 버전 작업입니다.
            </Text>
          )}
        </Stack>
      </Group>

      {trace.captureSetup ? (
        <Text size="xs" c="dimmed">
          촬영 방식 · {trace.captureSetup}
        </Text>
      ) : null}
      {trace.characterVisible !== undefined ? (
        <Text size="xs" c="dimmed">
          캐릭터 노출 · {trace.characterVisible ? "보임" : "보이지 않음"}
        </Text>
      ) : null}

      <ReferenceList
        label="기획 레퍼런스"
        references={trace.planned.references}
      />
      {trace.execution ? (
        <ReferenceList
          label="실제 사용 레퍼런스"
          references={trace.execution.references}
        />
      ) : null}
    </Stack>
  );
}

function ShotBody({
  draft,
  shot,
  imageEvaluation,
}: {
  draft: Draft;
  shot: DraftShot;
  imageEvaluation?: DraftEvaluation;
}) {
  if (shot.status === "draft") {
    return <GenerateShotForm draft={draft} shot={shot} />;
  }
  if (shot.status === "queued" || shot.status === "running") {
    return (
      <Text size="sm" c="dimmed">
        이미지를 생성하는 중입니다…
        {shot.provider ? ` · ${shot.provider}` : ""}
      </Text>
    );
  }
  if (shot.status === "failed") {
    return (
      <Alert color="red" title="생성 실패">
        <Stack gap={4}>
          <Text size="sm">{shot.errorMessage ?? "생성에 실패했습니다."}</Text>
          {/* 재생성은 needs_review·failed 초안에서만 허용된다
              (drafts.service.ts). 버튼이 없는 이유를 쓰지 않으면 운영자가
              막힌 채로 기다린다. */}
          {draft.status !== "needs_review" && draft.status !== "failed" ? (
            <Text size="xs" c="dimmed">
              다른 컷이 끝나 초안이 검수 또는 실패 상태가 되면 이 컷을 다시
              생성할 수 있습니다.
            </Text>
          ) : null}
        </Stack>
      </Alert>
    );
  }
  if (shot.outputs.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        생성된 후보가 없습니다.
      </Text>
    );
  }
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
      {shot.outputs.map((output) => (
        <CandidateCard
          key={output.mediaId}
          draft={draft}
          jobId={shot.jobId}
          output={output}
          shotSortOrder={shot.sortOrder}
          imageEvaluation={imageEvaluation}
        />
      ))}
    </SimpleGrid>
  );
}

// 수동 진행 컷 — 실행 직전에 최종 프롬프트와 후보 수를 고칠 수 있다.
function GenerateShotForm({ draft, shot }: { draft: Draft; shot: DraftShot }) {
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      prompt: shot.prompt,
      candidateCount: shot.candidateCount ?? 2,
    },
    validate: {
      prompt: (value) =>
        value.trim().length === 0 ? "프롬프트를 입력해 주세요" : null,
    },
  });

  const generate = useDraftMutation(
    draft.id,
    (values: { prompt: string; candidateCount: number }) =>
      generateShot(draft.id, shot.jobId, {
        prompt: values.prompt.trim(),
        candidateCount: values.candidateCount,
      }),
  );

  return (
    <form onSubmit={form.onSubmit((values) => generate.mutate(values))}>
      <Stack gap="xs">
        <Textarea
          label="최종 프롬프트"
          description={
            shot.prompt
              ? "실행 전 프롬프트를 수정할 수 있습니다."
              : "프롬프트가 비어 있습니다 — 상단 프롬프트 빌드를 먼저 실행하거나 직접 입력하세요."
          }
          autosize
          minRows={4}
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
        {generate.isError ? (
          <Alert color="red" role="alert" title="실행하지 못했습니다">
            {generate.error.message}
          </Alert>
        ) : null}
        <Group>
          <Button type="submit" loading={generate.isPending}>
            이미지 생성 실행
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
