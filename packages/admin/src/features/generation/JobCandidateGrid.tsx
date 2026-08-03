import {
  Badge,
  Button,
  Group,
  Image,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { previewUrl } from "../../shared/media/previewUrl";
import { ImageLightbox } from "../../shared/ui/ZoomableImage";
import type { OutputCandidate } from "./api";

// 후보 그리드. 확정 전에는 고를 수 있고, 확정 뒤에는 결과 표시만 남는다.
// 여기서는 이미지 클릭이 곧 선택이므로 확대는 별도 버튼으로 연다.
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
      {outputs.map((output) => (
        <CandidateTile
          key={output.mediaId}
          output={output}
          selected={output.mediaId === selectedMediaId}
          {...(onSelect ? { onSelect } : {})}
        />
      ))}
    </SimpleGrid>
  );
}

function CandidateTile({
  output,
  selected,
  onSelect,
}: {
  output: OutputCandidate;
  selected: boolean;
  onSelect?: (mediaId: string) => void;
}) {
  const [zoomed, { open, close }] = useDisclosure(false);
  const source = previewUrl(output.url);
  const label = `후보 ${output.candidateIndex + 1}`;
  const image = (
    <CandidateImage source={source} label={label} selected={selected} />
  );

  return (
    <Stack gap={4}>
      {onSelect ? (
        <UnstyledButton
          aria-label={`${label} 선택`}
          aria-pressed={selected}
          onClick={() => onSelect(output.mediaId)}
        >
          {image}
        </UnstyledButton>
      ) : (
        image
      )}
      <Group gap="xs" align="center">
        <Text size="xs">{label}</Text>
        {selected ? <Badge color="accent">선택됨</Badge> : null}
        {source ? (
          <Button
            variant="subtle"
            size="compact-xs"
            aria-label={`${label} 크게 보기`}
            onClick={open}
          >
            크게 보기
          </Button>
        ) : null}
      </Group>
      {source ? (
        <ImageLightbox
          opened={zoomed}
          onClose={close}
          src={source}
          alt={label}
        />
      ) : null}
    </Stack>
  );
}

function CandidateImage({
  source,
  label,
  selected,
}: {
  source: string | null;
  label: string;
  selected: boolean;
}) {
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
      alt={label}
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
