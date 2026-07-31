import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createMemories,
  createMemory,
  deleteMemory,
  updateMemory,
  type CharacterMemory,
} from "./api";

// 저장값은 영문 타입, 한글은 화면 라벨이다 (페르소나 제목과 같은 관례).
const MEMORY_TYPES = [
  { value: "fact", label: "일반 사실" },
  { value: "preference", label: "취향" },
  { value: "relationship", label: "관계" },
  { value: "event", label: "과거 사건" },
  { value: "routine", label: "습관·일과" },
  { value: "goal", label: "목표" },
];

export function CharacterMemoriesPanel({
  characterId,
  memories,
}: {
  characterId: string;
  memories: CharacterMemory[];
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { content: "", type: "fact", reason: "" },
    validate: {
      content: required("내용을 입력해 주세요"),
      type: required("타입을 선택해 주세요"),
      reason: required("출처·사유를 입력해 주세요"),
    },
  });
  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createMemory(characterId, trimMemory(values)),
    onSuccess: () => {
      form.reset();
      invalidate(queryClient, characterId);
    },
  });

  return (
    <Stack>
      <Paper p="md" component="section">
        <Stack gap="sm">
          <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
            <Stack gap="sm">
              <Title order={5}>메모리 추가</Title>
              <Text size="sm" c="dimmed">
                캐릭터의 확정된 사실만 한 메모리에 하나씩 작성합니다.
              </Text>
              <Textarea
                label="새 메모리 내용"
                rows={3}
                key={form.key("content")}
                {...form.getInputProps("content")}
              />
              <Group grow align="flex-start">
                <Select
                  label="타입"
                  data={MEMORY_TYPES}
                  allowDeselect={false}
                  key={form.key("type")}
                  {...form.getInputProps("type")}
                />
                <TextInput
                  label="등록 출처·사유"
                  key={form.key("reason")}
                  {...form.getInputProps("reason")}
                />
              </Group>
              <MutationAlert
                mutation={create}
                success="메모리를 추가했습니다."
              />
              <Group>
                <Button type="submit" loading={create.isPending}>
                  메모리 추가
                </Button>
              </Group>
            </Stack>
          </form>
          <MemoryBulkCreate characterId={characterId} />
        </Stack>
      </Paper>
      {memories.length === 0 ? (
        <Text c="dimmed">등록된 메모리가 없습니다.</Text>
      ) : (
        memories.map((memory) => (
          <MemoryForm
            key={memory.id}
            characterId={characterId}
            memory={memory}
          />
        ))
      )}
    </Stack>
  );
}

function MemoryForm({
  characterId,
  memory,
}: {
  characterId: string;
  memory: CharacterMemory;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      content: memory.content,
      type: memory.type,
      reason: memory.reason,
    },
    validate: {
      content: required("내용을 입력해 주세요"),
      type: required("타입을 선택해 주세요"),
      reason: required("출처·사유를 입력해 주세요"),
    },
  });
  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      updateMemory(characterId, memory.id, trimMemory(values)),
    onSuccess: () => invalidate(queryClient, characterId),
  });
  const remove = useMutation({
    mutationFn: () => deleteMemory(characterId, memory.id),
    onSuccess: () => invalidate(queryClient, characterId),
  });

  return (
    <Paper p="md" component="section">
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="sm">
          <Textarea
            label="메모리 내용"
            rows={3}
            key={form.key("content")}
            {...form.getInputProps("content")}
          />
          <Group grow align="flex-start">
            <Select
              label="타입"
              data={MEMORY_TYPES}
              allowDeselect={false}
              key={form.key("type")}
              {...form.getInputProps("type")}
            />
            <TextInput
              label="등록 출처·사유"
              key={form.key("reason")}
              {...form.getInputProps("reason")}
            />
          </Group>
          <MutationAlert mutation={save} success="메모리를 저장했습니다." />
          <MutationAlert mutation={remove} success="메모리를 삭제했습니다." />
          <Group>
            <Button type="submit" loading={save.isPending}>
              저장
            </Button>
            <Button
              type="button"
              variant="subtle"
              color="red"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              삭제
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

function MemoryBulkCreate({ characterId }: { characterId: string }) {
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: { items: "" },
    validate: {
      items: (value) => {
        try {
          parseMemoryItems(value);
          return null;
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "JSON을 확인해 주세요";
        }
      },
    },
  });
  const create = useMutation({
    mutationFn: (items: string) =>
      createMemories(characterId, parseMemoryItems(items)),
    onSuccess: () => {
      form.reset();
      invalidate(queryClient, characterId);
    },
  });

  return (
    <details>
      <summary>JSON 일괄 추가</summary>
      <form onSubmit={form.onSubmit(({ items }) => create.mutate(items))}>
        <Stack mt="xs" gap="xs">
          <Textarea
            label="메모리 JSON"
            description='[{"content":"제주 거주","type":"fact","reason":"초기 설정"}]'
            rows={4}
            key={form.key("items")}
            {...form.getInputProps("items")}
          />
          <Button type="submit" variant="default" loading={create.isPending}>
            일괄 추가
          </Button>
          <MutationAlert mutation={create} success="일괄 추가했습니다." />
        </Stack>
      </form>
    </details>
  );
}

function parseMemoryItems(
  value: string,
): Array<{ content: string; type: string; reason: string }> {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof (item as { content?: unknown }).content !== "string" ||
        typeof (item as { type?: unknown }).type !== "string" ||
        typeof (item as { reason?: unknown }).reason !== "string",
    )
  ) {
    throw new Error("content, type, reason을 가진 JSON 배열이 필요합니다.");
  }
  return parsed as Array<{ content: string; type: string; reason: string }>;
}

function trimMemory(values: { content: string; type: string; reason: string }) {
  return {
    content: values.content.trim(),
    type: values.type.trim(),
    reason: values.reason.trim(),
  };
}

function MutationAlert({
  mutation,
  success,
}: {
  mutation: { isError: boolean; isSuccess: boolean; error: Error | null };
  success: string;
}) {
  if (mutation.isError) {
    return (
      <Alert color="red" role="alert">
        {mutation.error?.message}
      </Alert>
    );
  }
  return mutation.isSuccess ? (
    <Alert color="teal" role="status">
      {success}
    </Alert>
  ) : null;
}

function required(message: string) {
  return (value: string) => (value.trim() ? null : message);
}

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  characterId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["character", characterId] });
}
