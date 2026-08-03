import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { TableText } from "../../shared/ui/TableText";
import { DraftDetailPanel } from "./DraftDetailPanel";
import { createDraft, fetchDrafts } from "./api";
import { DRAFT_STATUS_COLOR, DRAFT_STATUS_LABEL } from "./labels";

const STATUS_FILTER = [
  { value: "needs_review", label: "검수 필요" },
  { value: "planned", label: "기획 대기" },
  { value: "generating", label: "생성 중" },
  { value: "approved", label: "승인됨" },
  { value: "published", label: "게시됨" },
  { value: "failed", label: "실패" },
  { value: "", label: "전체" },
];

const MODE_OPTIONS = [
  { value: "manual", label: "수동 — 단계별 버튼으로 진행" },
  { value: "auto", label: "자동 — 워커가 끝까지 진행" },
];

export function DraftsPage() {
  // 검수 대기가 이 화면에 온 이유이므로 그 필터로 시작한다.
  const [status, setStatus] = useState("needs_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const drafts = useCursorList(["drafts", "list", status], (cursor) =>
    fetchDrafts({ ...(status ? { status } : {}), cursor }),
  );

  return (
    <DataPage
      title="초안 검수"
      isPending={drafts.isPending}
      error={drafts.error}
      isEmpty={drafts.items.length === 0}
      emptyLabel="조건에 맞는 초안이 없습니다."
      actions={
        <SegmentedControl
          aria-label="초안 상태"
          data={STATUS_FILTER}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setSelectedId(null);
          }}
        />
      }
    >
      <CreateDraftForm />

      <Table.ScrollContainer minWidth={880}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>캐릭터</Table.Th>
              <Table.Th>캡션</Table.Th>
              <Table.Th>상태</Table.Th>
              <Table.Th>게시 예정</Table.Th>
              <Table.Th>생성</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {drafts.items.map((draft) => (
              <Table.Tr key={draft.id}>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {draft.characterId}
                  </Text>
                </Table.Td>
                <Table.Td maw={320}>
                  <TableText lines={1}>
                    {draft.caption || "(기획 전)"}
                  </TableText>
                </Table.Td>
                <Table.Td>
                  <Badge color={DRAFT_STATUS_COLOR[draft.status]}>
                    {DRAFT_STATUS_LABEL[draft.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {draft.scheduledAt
                    ? draft.scheduledAt.replace("T", " ").slice(0, 16)
                    : "즉시"}
                </Table.Td>
                <Table.Td>{draft.createdAt.slice(0, 10)}</Table.Td>
                <Table.Td>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() =>
                      setSelectedId((current) =>
                        current === draft.id ? null : draft.id,
                      )
                    }
                  >
                    {selectedId === draft.id ? "닫기" : "상세"}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <LoadMore
        hasNextPage={drafts.hasNextPage}
        isFetching={drafts.isFetchingNextPage}
        onLoadMore={() => void drafts.fetchNextPage()}
      />

      {selectedId ? <DraftDetailPanel draftId={selectedId} /> : null}
    </DataPage>
  );
}

function CreateDraftForm() {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { characterId: "", sceneHint: "", mode: "manual" },
    validate: {
      characterId: (value) => (value ? null : "캐릭터를 선택해 주세요"),
    },
  });

  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createDraft({
        characterId: values.characterId,
        ...(values.sceneHint.trim()
          ? { sceneHint: values.sceneHint.trim() }
          : {}),
        mode: values.mode,
      }),
    onSuccess: () => {
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["drafts", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
    },
  });

  return (
    <Paper p="md" component="section">
      <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
        <Stack gap="xs">
          <Group align="flex-end" gap="sm" wrap="wrap">
            <CharacterSelect
              w={220}
              key={form.key("characterId")}
              {...form.getInputProps("characterId")}
            />
            <TextInput
              label="장면 힌트"
              description="선택"
              placeholder="예: 비 오는 날 창가 카페에서 필름 카메라를 닦는 장면"
              flex={1}
              miw={260}
              key={form.key("sceneHint")}
              {...form.getInputProps("sceneHint")}
            />
            <Select
              label="진행 방식"
              data={MODE_OPTIONS}
              allowDeselect={false}
              w={260}
              key={form.key("mode")}
              {...form.getInputProps("mode")}
            />
            <Button type="submit" loading={create.isPending}>
              초안 만들기
            </Button>
          </Group>
          {create.isError ? (
            <Alert color="red" role="alert" title="만들지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Paper>
  );
}
