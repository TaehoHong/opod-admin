import {
  Badge,
  Image,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { previewUrl } from "../../shared/media/previewUrl";
import type { OutputCandidate } from "./api";

// 후보 그리드. 확정 전에는 고를 수 있고, 확정 뒤에는 결과 표시만 남는다.
export function JobCandidateGrid({
  outputs,
  selectedMediaId,
  onSelect,
}: {
  outputs: OutputCandidate[];
  selectedMediaId?: string;
  onSelect?: (mediaId: string) => void;
}) {
  if (outputs.length === 0) {
    return <Text c="dimmed">생성된 후보가 없습니다.</Text>;
  }

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
      {outputs.map((output) => {
        const selected = output.mediaId === selectedMediaId;
        const tile = (
          <Stack gap={4}>
            <CandidateImage output={output} selected={selected} />
            <Text size="xs">후보 {output.candidateIndex + 1}</Text>
            {selected ? <Badge color="accent">선택됨</Badge> : null}
          </Stack>
        );
        return onSelect ? (
          <UnstyledButton
            key={output.mediaId}
            aria-pressed={selected}
            onClick={() => onSelect(output.mediaId)}
          >
            {tile}
          </UnstyledButton>
        ) : (
          <div key={output.mediaId}>{tile}</div>
        );
      })}
    </SimpleGrid>
  );
}

function CandidateImage({
  output,
  selected,
}: {
  output: OutputCandidate;
  selected: boolean;
}) {
  const source = previewUrl(output.url);
  if (!source) {
    return (
      <Text size="xs" c="dimmed">
        미리보기 없음
      </Text>
    );
  }
  return (
    <Image
      src={source}
      alt={`후보 ${output.candidateIndex + 1}`}
      h={160}
      fit="contain"
      style={
        selected
          ? { outline: "2px solid var(--mantine-color-accent-4)" }
          : undefined
      }
    />
  );
}
