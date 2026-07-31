import {
  Badge,
  Button,
  Image,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { previewUrl } from "../../shared/media/previewUrl";
import {
  finishPreviewUrl,
  outputFinishPreset,
  selectShotOutput,
  updateShotOutputFilter,
  type Draft,
  type DraftShotOutput,
  type FinishPreset,
} from "./api";
import { FINISH_OPTIONS } from "./labels";
import { useDraftMutation } from "./useDraftMutation";

// 후보 이미지 한 장. 게시 선택과 마감 프리셋은 서로 다른 결정이라 컨트롤을
// 분리한다 — 이미지를 누르는 것만으로 게시본이 바뀌지 않는다.
export function CandidateCard({
  draft,
  jobId,
  output,
}: {
  draft: Draft;
  jobId: string;
  output: DraftShotOutput;
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
  const source =
    preset === "none"
      ? previewUrl(output.url)
      : finishPreviewUrl(output.mediaId, preset);

  return (
    <Stack gap={6}>
      {source ? (
        <Image
          src={source}
          alt={`후보 ${output.candidateIndex + 1}`}
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
