import {
  Button,
  Group,
  NumberInput,
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
import { MutationAlert } from "../../shared/ui/MutationAlert";
import {
  createPersona,
  createPersonas,
  deletePersona,
  reorderPersonas,
  updatePersona,
  type CharacterPersona,
} from "./api";

// 표준 블록 13종. 제목은 Agent와 기획 프롬프트에 원문 그대로 들어가므로
// 저장값은 영문 키로 두고 한글은 화면 라벨로만 쓴다. 목록 순서가 곧 관례상의
// 블록 순서지만 실제 순서는 sortOrder가 담당한다 — 제목에 번호를 붙이지 않는다.
const PERSONA_TITLES = [
  { value: "identity", label: "기본 프로필" },
  { value: "personality", label: "성격" },
  { value: "values", label: "가치관" },
  { value: "emotions", label: "감정·대인" },
  { value: "voice", label: "말투" },
  { value: "world", label: "배경" },
  { value: "content_style", label: "콘텐츠 스타일" },
  { value: "capture_style", label: "촬영 방식" },
  { value: "relationships", label: "관계" },
  { value: "preferences", label: "취향" },
  { value: "boundaries", label: "가드레일" },
  { value: "greeting", label: "첫인사" },
  { value: "examples", label: "대화 예시" },
];

const PERSONA_TITLE_OPTIONS = PERSONA_TITLES.map(({ value, label }) => ({
  value,
  label: `${label} (${value})`,
}));

// 프리셋은 제목 입력을 채워 주는 보조 장치다. 표준 블록에 없는 제목도 그대로
// 저장할 수 있어야 하므로 제목 입력이 값의 주인이고 select는 강제하지 않는다.
function PersonaTitlePreset({
  defaultTitle,
  onPick,
}: {
  defaultTitle: string;
  onPick: (title: string) => void;
}) {
  return (
    <Select
      label="제목 타입"
      placeholder="직접 입력"
      data={PERSONA_TITLE_OPTIONS}
      defaultValue={
        PERSONA_TITLES.some((preset) => preset.value === defaultTitle)
          ? defaultTitle
          : null
      }
      onChange={(value) => {
        if (value) onPick(value);
      }}
      searchable
      clearable
    />
  );
}

export function CharacterPersonasPanel({
  characterId,
  personas,
}: {
  characterId: string;
  personas: CharacterPersona[];
}) {
  const queryClient = useQueryClient();
  const form = useForm<{
    title: string;
    content: string;
    sortOrder: number | string;
  }>({
    mode: "uncontrolled",
    initialValues: { title: "", content: "", sortOrder: "" },
    validate: {
      title: required("제목을 입력해 주세요"),
      content: required("내용을 입력해 주세요"),
    },
  });
  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createPersona(characterId, {
        title: values.title.trim(),
        content: values.content.trim(),
        ...(values.sortOrder === ""
          ? {}
          : { sortOrder: Number(values.sortOrder) }),
      }),
    onSuccess: () => {
      form.reset();
      invalidate(queryClient, characterId);
    },
  });
  const reorder = useMutation({
    mutationFn: (personaIds: string[]) =>
      reorderPersonas(characterId, personaIds),
    onSuccess: () => invalidate(queryClient, characterId),
  });

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= personas.length) return;
    const ids = personas.map((persona) => persona.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <Stack>
      <Paper p="md" component="section">
        <Stack gap="sm">
          <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
            <Stack gap="sm">
              <Title order={5}>페르소나 추가</Title>
              <Text c="dimmed" size="sm">
                제목 타입을 고르면 제목에 반영됩니다. 표준 블록에 없는 제목은
                직접 입력하세요. 한 블록에는 하나의 관심사만 담습니다.
              </Text>
              <Group grow align="flex-start">
                <PersonaTitlePreset
                  defaultTitle=""
                  onPick={(title) => form.setFieldValue("title", title)}
                />
                <TextInput
                  label="새 페르소나 제목"
                  key={form.key("title")}
                  {...form.getInputProps("title")}
                />
                <NumberInput
                  label="정렬 순서"
                  description="선택"
                  key={form.key("sortOrder")}
                  {...form.getInputProps("sortOrder")}
                />
              </Group>
              <Textarea
                label="새 페르소나 내용"
                rows={4}
                key={form.key("content")}
                {...form.getInputProps("content")}
              />
              <MutationAlert
                mutation={create}
                success="페르소나를 추가했습니다."
              />
              <Group>
                <Button type="submit" loading={create.isPending}>
                  페르소나 추가
                </Button>
              </Group>
            </Stack>
          </form>
          <PersonaBulkCreate characterId={characterId} />
        </Stack>
      </Paper>

      {personas.length === 0 ? (
        <Text c="dimmed">등록된 페르소나가 없습니다.</Text>
      ) : (
        personas.map((persona, index) => (
          <PersonaForm
            key={persona.id}
            characterId={characterId}
            persona={persona}
            first={index === 0}
            last={index === personas.length - 1}
            moving={reorder.isPending}
            onMove={(offset) => move(index, offset)}
          />
        ))
      )}
      <MutationAlert mutation={reorder} success="순서를 변경했습니다." />
    </Stack>
  );
}

function PersonaForm({
  characterId,
  persona,
  first,
  last,
  moving,
  onMove,
}: {
  characterId: string;
  persona: CharacterPersona;
  first: boolean;
  last: boolean;
  moving: boolean;
  onMove: (offset: number) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      title: persona.title,
      content: persona.content,
      sortOrder: persona.sortOrder,
    },
    validate: {
      title: required("제목을 입력해 주세요"),
      content: required("내용을 입력해 주세요"),
    },
  });
  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      updatePersona(characterId, persona.id, {
        title: values.title.trim(),
        content: values.content.trim(),
        sortOrder: Number(values.sortOrder),
      }),
    onSuccess: () => invalidate(queryClient, characterId),
  });
  const remove = useMutation({
    mutationFn: () => deletePersona(characterId, persona.id),
    onSuccess: () => invalidate(queryClient, characterId),
  });

  return (
    <Paper p="md" component="section">
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="sm">
          <Group grow align="flex-start">
            <PersonaTitlePreset
              defaultTitle={persona.title}
              onPick={(title) => form.setFieldValue("title", title)}
            />
            <TextInput
              label="페르소나 제목"
              key={form.key("title")}
              {...form.getInputProps("title")}
            />
            <NumberInput
              label="정렬 순서"
              key={form.key("sortOrder")}
              {...form.getInputProps("sortOrder")}
            />
          </Group>
          <Textarea
            label="페르소나 내용"
            rows={4}
            key={form.key("content")}
            {...form.getInputProps("content")}
          />
          <MutationAlert mutation={save} success="페르소나를 저장했습니다." />
          <MutationAlert mutation={remove} success="페르소나를 삭제했습니다." />
          <Group>
            <Button type="submit" loading={save.isPending}>
              저장
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={first || moving}
              onClick={() => onMove(-1)}
            >
              위로
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={last || moving}
              onClick={() => onMove(1)}
            >
              아래로
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

function PersonaBulkCreate({ characterId }: { characterId: string }) {
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: { items: "" },
    validate: {
      items: (value) => {
        try {
          parsePersonaItems(value);
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
      createPersonas(characterId, parsePersonaItems(items)),
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
            label="페르소나 JSON"
            description='[{"title":"말투","content":"친근하게 말한다"}]'
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

function parsePersonaItems(
  value: string,
): Array<{ title: string; content: string }> {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof (item as { title?: unknown }).title !== "string" ||
        typeof (item as { content?: unknown }).content !== "string",
    )
  ) {
    throw new Error("title과 content를 가진 JSON 배열이 필요합니다.");
  }
  return parsed as Array<{ title: string; content: string }>;
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
