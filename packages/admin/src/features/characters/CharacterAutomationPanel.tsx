import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { draftTitle, fetchDrafts, type Draft } from "../drafts/api";

// V4는 ⑥ 캡션 전까지 캡션이 비어 있다 — 기획 전제를 가제로 보인다.
function draftTitleText(draft: Pick<Draft, "caption" | "conceptJson">) {
  const title = draftTitle(draft);
  return title.provisional && title.text !== "(제목 없음)"
    ? `${title.text} (가제)`
    : title.text;
}
import { DRAFT_STATUS_COLOR, DRAFT_STATUS_LABEL } from "../drafts/labels";
import {
  fetchPostingPolicy,
  updatePostingPolicy,
  type PostingPolicy,
} from "./api";

export function CharacterAutomationPanel({
  characterId,
}: {
  characterId: string;
}) {
  const policy = useQuery({
    queryKey: ["character", characterId, "posting-policy"],
    queryFn: () => fetchPostingPolicy(characterId),
  });

  if (policy.isPending) {
    return <Loader aria-label="포스팅 정책 불러오는 중" />;
  }
  if (policy.error) {
    return (
      <Alert color="red" role="alert" title="포스팅 정책을 불러오지 못했습니다">
        {policy.error.message}
      </Alert>
    );
  }
  return policy.data ? (
    <Stack>
      <PostingPolicyForm
        key={policy.data.updatedAt ?? "default"}
        characterId={characterId}
        policy={policy.data}
      />
      <CharacterDraftQueue characterId={characterId} />
    </Stack>
  ) : null;
}

function CharacterDraftQueue({ characterId }: { characterId: string }) {
  const drafts = useQuery({
    queryKey: ["drafts", "character", characterId],
    queryFn: () => fetchDrafts({ characterId, limit: "10" }),
  });

  const items = drafts.data?.items ?? [];

  return (
    <Paper p="md" maw={680} component="section">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={5}>게시물</Title>
          <Button
            component={Link}
            to={`/posts/new/brief?characterId=${encodeURIComponent(characterId)}`}
          >
            게시물 만들기
          </Button>
        </Group>

        <Text size="xs" c="dimmed" tt="uppercase">
          최근 초안
        </Text>
        {drafts.isPending ? (
          <Loader size="sm" aria-label="최근 초안 불러오는 중" />
        ) : items.length === 0 ? (
          <Text size="sm" c="dimmed">
            초안이 없습니다.
          </Text>
        ) : (
          items.map((draft) => (
            <UnstyledButton
              key={draft.id}
              component={Link}
              to={`/posts/${encodeURIComponent(draft.id)}`}
            >
              <Group gap="sm" wrap="nowrap" align="baseline">
                <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                  {draftTitleText(draft)}
                </Text>
                <Badge color={DRAFT_STATUS_COLOR[draft.status]}>
                  {DRAFT_STATUS_LABEL[draft.status]}
                </Badge>
                <Text size="xs" c="dimmed">
                  {draft.scheduledAt
                    ? draft.scheduledAt.replace("T", " ").slice(0, 16)
                    : "즉시"}
                </Text>
              </Group>
            </UnstyledButton>
          ))
        )}
      </Stack>
    </Paper>
  );
}

function PostingPolicyForm({
  characterId,
  policy,
}: {
  characterId: string;
  policy: PostingPolicy;
}) {
  const queryClient = useQueryClient();
  const form = useForm<{
    enabled: boolean;
    weeklyCadence: number | string;
    hourStartKst: number | string;
    hourEndKst: number | string;
  }>({
    mode: "uncontrolled",
    initialValues: {
      enabled: policy.enabled,
      weeklyCadence: policy.weeklyCadence,
      hourStartKst: policy.hourStartKst,
      hourEndKst: policy.hourEndKst,
    },
    validate: {
      weeklyCadence: range(1, 21),
      hourStartKst: range(0, 23),
      hourEndKst: range(0, 23),
    },
  });
  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      updatePostingPolicy(characterId, {
        enabled: values.enabled,
        weeklyCadence: Number(values.weeklyCadence),
        hourStartKst: Number(values.hourStartKst),
        hourEndKst: Number(values.hourEndKst),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["character", characterId, "posting-policy"],
      }),
  });

  return (
    <Paper p="md" maw={680} component="section">
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="sm">
          <Title order={5}>포스팅 정책</Title>
          <Text size="sm" c="dimmed">
            활성화하면 스케줄러가 이 시간대에 자동 초안을 기획합니다.
          </Text>
          <Checkbox
            label="자동 포스팅 활성화"
            key={form.key("enabled")}
            {...form.getInputProps("enabled", { type: "checkbox" })}
          />
          <NumberInput
            label="주당 게시 횟수"
            min={1}
            max={21}
            key={form.key("weeklyCadence")}
            {...form.getInputProps("weeklyCadence")}
          />
          <Group grow align="flex-start">
            <NumberInput
              label="시작 시각 (KST)"
              min={0}
              max={23}
              key={form.key("hourStartKst")}
              {...form.getInputProps("hourStartKst")}
            />
            <NumberInput
              label="종료 시각 (KST)"
              min={0}
              max={23}
              key={form.key("hourEndKst")}
              {...form.getInputProps("hourEndKst")}
            />
          </Group>
          {save.isError ? (
            <Alert color="red" role="alert" title="저장하지 못했습니다">
              {save.error.message}
            </Alert>
          ) : null}
          {save.isSuccess ? (
            <Alert color="teal" role="status">
              포스팅 정책을 저장했습니다.
            </Alert>
          ) : null}
          <Button type="submit" loading={save.isPending}>
            정책 저장
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}

function range(min: number, max: number) {
  return (value: number | string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max
      ? null
      : `${min}~${max} 범위의 정수를 입력해 주세요`;
  };
}
