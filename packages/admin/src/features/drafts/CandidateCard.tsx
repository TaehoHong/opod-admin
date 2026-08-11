import { Badge, Button, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { previewUrl } from "../../shared/media/previewUrl";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import {
  finishPreviewUrl,
  outputFinishPreset,
  selectShotOutput,
  updateShotOutputFilter,
  type Draft,
  type DraftEvaluation,
  type DraftShotOutput,
  type FinishPreset,
} from "./api";
import { EvaluationChips } from "./EvaluationChips";
import { FINISH_LABEL, FINISH_OPTIONS } from "./labels";
import { useDraftMutation } from "./useDraftMutation";

// 후보 이미지 한 장. 게시 선택과 마감 프리셋은 서로 다른 결정이라 컨트롤을
// 분리한다 — 이미지를 누르는 것만으로 게시본이 바뀌지 않는다. 이미지 클릭은
// 확대해서 보기다.
export function CandidateCard({
  draft,
  jobId,
  output,
  shotSortOrder,
  imageEvaluation,
}: {
  draft: Draft;
  jobId: string;
  output: DraftShotOutput;
  shotSortOrder: number;
  imageEvaluation?: DraftEvaluation;
}) {
  const preset = outputFinishPreset(draft, output);
  const editable = draft.status !== "published" && draft.status !== "rejected";

  const select = useDraftMutation(draft.id, () =>
    selectShotOutput(draft.id, jobId, output.mediaId),
  );
  const setFilter = useDraftMutation(draft.id, (value: FinishPreset) =>
    updateShotOutputFilter(draft.id, jobId, output.mediaId, value),
  );

  // 마감이 걸린 후보는 서버가 만든 미리보기 바이트를 보여준다. 원본은
  // 저장된 URL을 그대로 쓴다.
  const original = previewUrl(output.url);
  const finished =
    preset === "none" ? null : finishPreviewUrl(output.mediaId, preset);
  const source = finished ?? original;

  // 마감이 걸렸으면 확대는 원본/마감 비교로 연다 — 필터가 무엇을 바꿨는지는
  // 나란히 놓고 봐야 판단할 수 있다. 원본 URL을 못 쓰면 마감본만 크게 본다.
  const compare =
    finished && original
      ? {
          src: finished,
          label: `마감 · ${FINISH_LABEL[preset]}`,
          baseLabel: "원본",
        }
      : undefined;

  // 확대까지 가지 않고 카드 위에서 바로 대조하는 길도 남긴다 — 누르는 동안만
  // 원본으로 바뀐다.
  const [showOriginal, setShowOriginal] = useState(false);
  const thumbnail = showOriginal && original ? original : source;

  return (
    <Stack gap={6}>
      {thumbnail ? (
        <ZoomableImage
          src={thumbnail}
          alt={`후보 ${output.candidateIndex + 1}`}
          zoomSrc={original ?? thumbnail}
          {...(compare ? { compare } : {})}
          h={160}
          fit="contain"
          style={
            output.selected
              ? { outline: "2px solid var(--mantine-color-accent-4)" }
              : undefined
          }
        />
      ) : (
        <Text size="xs" c="dimmed">
          미리보기 없음
        </Text>
      )}

      <EvaluationChips
        evaluation={imageEvaluation}
        shotSortOrder={shotSortOrder}
        candidateIndex={output.candidateIndex}
      />

      {output.selected ? (
        <Badge color="accent">✓ 게시 이미지</Badge>
      ) : (
        <Button
          variant="default"
          size="compact-sm"
          disabled={!editable}
          loading={select.isPending}
          onClick={() => select.mutate()}
        >
          이 이미지 선택
        </Button>
      )}

      {compare ? (
        <Button
          variant="default"
          size="compact-xs"
          aria-pressed={showOriginal}
          onMouseDown={() => setShowOriginal(true)}
          onMouseUp={() => setShowOriginal(false)}
          onMouseLeave={() => setShowOriginal(false)}
          onTouchStart={() => setShowOriginal(true)}
          onTouchEnd={() => setShowOriginal(false)}
          // 키보드로도 대조할 수 있어야 한다 (docs/04-design-rules.md:81).
          onFocus={() => setShowOriginal(true)}
          onBlur={() => setShowOriginal(false)}
        >
          누르고 원본 비교
        </Button>
      ) : null}

      <SegmentedControl
        size="xs"
        aria-label={`후보 ${output.candidateIndex + 1} 마감`}
        data={[...FINISH_OPTIONS]}
        value={preset}
        disabled={!editable || setFilter.isPending}
        onChange={(value) => setFilter.mutate(value as FinishPreset)}
      />

      {select.isError || setFilter.isError ? (
        <Text size="xs" c="red" role="alert">
          {(select.error ?? setFilter.error)?.message}
        </Text>
      ) : null}
    </Stack>
  );
}
