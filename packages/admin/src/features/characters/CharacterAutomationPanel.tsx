import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createDraft, fetchDrafts } from "../drafts/api";
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

// 이 캐릭터의 초안을 여기서 시작하고, 최근 초안에서 바로 상세로 들어간다.
// 자동화를 켜 두는 화면과 그 결과를 보는 화면이 떨어져 있으면 운영자가 매번
// 초안 목록에서 캐릭터를 다시 찾아야 한다.
const DRAFT_MODES = [
  { value: "manual", label: "수동 — 단계별 버튼으로 진행" },
  { value: "auto", label: "자동 — 워커가 끝까지 진행" },
];

function CharacterDraftQueue({ characterId }: { characterId: string }) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { sceneHint: "", mode: "auto" },
  });
  const drafts = useQuery({
    queryKey: ["drafts", "character", characterId],
    queryFn: () => fetchDrafts({ characterId, limit: "10" }),
  });

  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createDraft({
        characterId,
        ...(values.sceneHint.trim()
          ? { sceneHint: values.sceneHint.trim() }
          : {}),
        mode: values.mode,
      }),
    onSuccess: () => {
      form.reset();
      void queryClient.invalidateQueries({
        queryKey: ["drafts", "character", characterId],
      });
      void queryClient.invalidateQueries({ queryKey: ["drafts", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
    },
  });

  const items = drafts.data?.items ?? [];

  return (
    <Paper p="md" maw={680} component="section">
      <Stack gap="sm">
        <Title order={5}>초안</Title>
        <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="장면 힌트"
              description="선택"
              placeholder="예: 비 오는 날 창가 카페"
              flex={1}
              miw={220}
              key={form.key("sceneHint")}
              {...form.getInputProps("sceneHint")}
            />
            <Select
              label="진행 방식"
              data={DRAFT_MODES}
              allowDeselect={false}
              w={240}
              key={form.key("mode")}
              {...form.getInputProps("mode")}
            />
            <Button type="submit" loading={create.isPending}>
              기획 큐 등록
            </Button>
          </Group>
        </form>
        {create.isError ? (
          <Alert color="red" role="alert" title="만들지 못했습니다">
            {create.error.message}
          </Alert>
        ) : null}
        {create.isSuccess ? (
          <Alert color="teal" role="status">
            초안을 만들었습니다. 아래 목록에서 상세로 들어갈 수 있습니다.
          </Alert>
        ) : null}

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
              to={`/drafts/${encodeURIComponent(draft.id)}`}
            >
              <Group gap="sm" wrap="nowrap" align="baseline">
                <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                  {draft.caption || "(기획 전)"}
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
