import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Image,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { CandidateCard } from "./CandidateCard";
import {
  generateShot,
  regenerateShot,
  type Draft,
  type DraftShot,
} from "./api";
import { SHOT_STATUS_COLOR, SHOT_STATUS_LABEL } from "./labels";
import { useDraftMutation } from "./useDraftMutation";

export function ShotCard({ draft, shot }: { draft: Draft; shot: DraftShot }) {
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
        </Group>

        {shot.scene ? (
          <Text size="sm" c="dimmed">
            장면 · {shot.scene}
          </Text>
        ) : null}

        {shot.references?.length ? (
          <Stack gap={4}>
            <Text size="xs" c="dimmed" tt="uppercase">
              선별 레퍼런스 {shot.references.length}장 — 기획 LLM이 장면에 맞게
              골랐습니다
            </Text>
            <Group gap={6}>
              {shot.references.map((reference) => (
                <Image
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
        ) : null}

        <ShotBody draft={draft} shot={shot} />

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

function ShotBody({ draft, shot }: { draft: Draft; shot: DraftShot }) {
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
        {shot.errorMessage ?? "생성에 실패했습니다."}
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
