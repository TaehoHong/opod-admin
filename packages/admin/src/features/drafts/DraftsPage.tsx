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
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useDetailSelection } from "../../shared/routing/useDetailSelection";
import { useCursorList } from "../../shared/api/useCursorList";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import { TableText } from "../../shared/ui/TableText";
import { DraftDetailPanel } from "./DraftDetailPanel";
import { createDraft, fetchDrafts, type Draft } from "./api";
import { DRAFT_STATUS_COLOR, DRAFT_STATUS_LABEL } from "./labels";
import { draftDetailKey } from "./useDraftMutation";

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
  const { selectedId, select, toggle } = useDetailSelection(
    "draftId",
    "/drafts",
  );
  const detailRef = useRef<HTMLDivElement>(null);

  const drafts = useCursorList(["drafts", "list", status], (cursor) =>
    fetchDrafts({ ...(status ? { status } : {}), cursor }),
  );

  // 상세는 목록 아래에 열리므로 그냥 두면 화면 밖에 생긴다. 방금 연 초안으로
  // 데려간다. jsdom에는 scrollIntoView가 없어 optional call로 둔다.
  useEffect(() => {
    if (selectedId) {
      detailRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [selectedId]);

  return (
    <DataPage
      title="초안 검수"
      isPending={drafts.isPending}
      error={drafts.error}
      actions={
        <SegmentedControl
          aria-label="초안 상태"
          data={STATUS_FILTER}
          value={status}
          onChange={(value) => {
            setStatus(value);
            select(null);
          }}
        />
      }
    >
      <CreateDraftForm onCreated={(draft) => select(draft.id)} />

      {/* 빈 목록을 DataPage에 맡기면 children이 통째로 사라져 생성 폼과 상세까지
          가려진다. 방금 만든 초안은 planned라 기본 필터(검수 필요)에 잡히지 않으므로
          목록만 비고 나머지는 남아 있어야 한다. */}
      {drafts.items.length === 0 ? (
        <Alert color="gray">조건에 맞는 초안이 없습니다.</Alert>
      ) : (
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
                    <CharacterName id={draft.characterId} />
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
                      onClick={() => toggle(draft.id)}
                    >
                      {selectedId === draft.id ? "닫기" : "상세"}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <LoadMore
        hasNextPage={drafts.hasNextPage}
        isFetching={drafts.isFetchingNextPage}
        onLoadMore={() => void drafts.fetchNextPage()}
      />

      {selectedId ? (
        <div ref={detailRef}>
          <DraftDetailPanel draftId={selectedId} />
        </div>
      ) : null}
    </DataPage>
  );
}

// 초안을 만들면 바로 그 초안의 단계 타임라인으로 들어가야 다음 행동(기획 실행)을
// 이어서 할 수 있다. 만들고 목록에 남겨두면 방금 만든 초안을 다시 찾아야 한다.
function CreateDraftForm({ onCreated }: { onCreated: (draft: Draft) => void }) {
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
    onSuccess: (draft) => {
      form.reset();
      // 응답이 곧 상세 데이터다. 캐시에 넣어 두면 상세가 재조회를 기다리지 않는다.
      queryClient.setQueryData(draftDetailKey(draft.id), draft);
      void queryClient.invalidateQueries({ queryKey: ["drafts", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
      onCreated(draft);
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
          <MutationAlert
            mutation={create}
            success="초안을 만들었습니다. 아래 상세에서 이어서 진행하세요."
            errorTitle="만들지 못했습니다"
          />
        </Stack>
      </form>
    </Paper>
  );
}
