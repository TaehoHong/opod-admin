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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import { OperationErrorAlert } from "../../shared/ui/OperationErrorAlert";
import {
  createPersona,
  createPersonas,
  deletePersona,
  fetchPersonaStructure,
  reorderPersonas,
  updatePersona,
  type CharacterPersona,
} from "./api";

// 작성용 제목 목록이다. 실제 처리 역할·주입 방식은 구조 API가 소유한다.
// 저장값은 영문 키로 두고 한글은 화면 라벨로만 쓴다. 목록 순서가 곧 관례상의
// 블록 순서지만 실제 순서는 sortOrder가 담당한다 — 제목에 번호를 붙이지 않는다.
const PERSONA_TITLES = [
  { value: "identity", label: "기본 프로필" },
  { value: "appearance", label: "외형" },
  { value: "personality", label: "성격" },
  { value: "values", label: "가치관" },
  { value: "social_style", label: "대인 반응" },
  { value: "emotions", label: "감정·대인" },
  { value: "voice", label: "말투" },
  { value: "world", label: "배경" },
  { value: "content_style", label: "콘텐츠 스타일" },
  { value: "capture_style", label: "촬영 방식" },
  { value: "relationships", label: "관계" },
  { value: "preferences", label: "취향" },
  { value: "goals", label: "목표" },
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
  title,
  onPick,
}: {
  title: string;
  onPick: (title: string) => void;
}) {
  return (
    <Select
      label="내용 분류"
      description="제목 입력용 분류이며, 채팅 처리 정책은 바꾸지 않습니다."
      placeholder="직접 입력"
      data={
        !title || PERSONA_TITLES.some((preset) => preset.value === title)
          ? PERSONA_TITLE_OPTIONS
          : [
              ...PERSONA_TITLE_OPTIONS,
              { value: title, label: `직접 입력 (${title})` },
            ]
      }
      value={title || null}
      onChange={(value) => {
        if (value) onPick(value);
      }}
      searchable
      allowDeselect={false}
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
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<{
    title: string;
    content: string;
    sortOrder: number | string;
  }>({
    mode: "controlled",
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
      setCreating(false);
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
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={4}>페르소나</Title>
          <Text size="sm" c="dimmed">
            캐릭터 판단과 표현에 사용하는 {personas.length}개 블록
          </Text>
        </Stack>
        <Button onClick={() => setCreating(true)}>페르소나 추가</Button>
      </Group>
      {creating ? (
        <Paper p="md" component="section">
          <Stack gap="sm">
            <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
              <Stack gap="sm">
                <Title order={5}>새 페르소나</Title>
                <Text c="dimmed" size="sm">
                  내용 분류를 고르면 제목에 반영됩니다. 목록에 없는 제목은 직접
                  입력하세요. 한 블록에는 하나의 관심사만 담습니다.
                </Text>
                <Group grow align="flex-start">
                  <PersonaTitlePreset
                    title={form.values.title}
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
                    페르소나 저장
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={create.isPending}
                    onClick={() => setCreating(false)}
                  >
                    취소
                  </Button>
                </Group>
              </Stack>
            </form>
            <PersonaBulkCreate characterId={characterId} />
          </Stack>
        </Paper>
      ) : null}

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
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "controlled",
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
    onSuccess: () => {
      setEditing(false);
      invalidate(queryClient, characterId);
    },
  });
  const remove = useMutation({
    mutationFn: () => deletePersona(characterId, persona.id),
    onSuccess: () => invalidate(queryClient, characterId),
  });

  if (!editing) {
    return (
      <Paper p="md" component="section">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={2} miw={0}>
              <Text fw={750}>{persona.title}</Text>
              <Text size="xs" c="dimmed">
                정렬 순서 {persona.sortOrder} · 스키마 v{persona.schemaVersion}
              </Text>
            </Stack>
            <Button variant="default" onClick={() => setEditing(true)}>
              수정
            </Button>
          </Group>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {persona.content}
          </Text>
          <PersonaProcessing characterId={characterId} personaId={persona.id} />
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper p="md" component="section">
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="sm">
          <Group grow align="flex-start">
            <PersonaTitlePreset
              title={form.values.title}
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
          <PersonaProcessing characterId={characterId} personaId={persona.id} />
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
              disabled={save.isPending || remove.isPending}
              onClick={() => setEditing(false)}
            >
              취소
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

const PERSONA_ROLES: Record<string, string> = {
  identity: "정체성",
  behavior: "행동 성향",
  voice: "말투",
  lore: "배경 정보",
  example: "대화 예시",
  greeting: "첫인사",
  creator_note: "제작자 메모",
  motivation: "욕구·동기",
  judgment: "판단 기준",
  tension: "내적 긴장",
  relationship: "관계 방식",
  boundary: "행동 경계",
};
const PERSONA_INJECTIONS: Record<string, string> = {
  always: "항상 주입",
  start_only: "대화 시작 시",
  retrieved: "관련 문맥에서 선별 주입",
  never_prompt: "직접 주입 제외",
};

function PersonaProcessing({
  characterId,
  personaId,
}: {
  characterId: string;
  personaId: string;
}) {
  const structure = useQuery({
    queryKey: ["character", characterId, "persona-structure", personaId],
    queryFn: () => fetchPersonaStructure(characterId, personaId),
  });
  if (structure.isPending)
    return (
      <Text size="sm" role="status">
        채팅 처리 정보 조회 중…
      </Text>
    );
  if (structure.isError)
    return (
      <Stack gap="xs">
        <OperationErrorAlert
          failure={{
            problem: "채팅 처리 정보를 불러오지 못했습니다.",
            cause: "조회에 실패하여 현재 저장된 정책을 확인할 수 없습니다.",
            nextAction:
              "다시 조회하세요. 계속 실패하면 서버 연결을 확인하세요.",
            technicalDetail: structure.error.message,
          }}
        />
        <Button
          type="button"
          variant="default"
          loading={structure.isFetching}
          onClick={() => void structure.refetch()}
        >
          처리 정보 다시 조회
        </Button>
      </Stack>
    );
  return (
    <Stack gap="xs" aria-label="저장된 채팅 처리 정책">
      <Text size="sm" fw={500}>
        채팅 처리 · 페르소나 스키마 v{structure.data.schemaVersion ?? 1} ·
        저장된 정책 (읽기 전용)
      </Text>
      {structure.data.fragments.length === 0 ? (
        <Text size="sm" c="dimmed">
          저장된 처리 역할·주입 방식이 없습니다. 기존 처리 규칙을 사용하며,
          제목으로 추정해 표시하지 않습니다.
        </Text>
      ) : (
        structure.data.fragments.map((fragment) => (
          <Group key={fragment.id} gap="sm">
            {structure.data.fragments.length > 1 && (
              <Text size="sm">조각 {fragment.ordinal + 1}</Text>
            )}
            <Text size="sm">
              처리 역할: {PERSONA_ROLES[fragment.kind] ?? "알 수 없는 역할"} (
              {fragment.kind})
            </Text>
            <Text size="sm">
              주입 방식:{" "}
              {PERSONA_INJECTIONS[fragment.injection] ?? "알 수 없는 방식"} (
              {fragment.injection})
            </Text>
          </Group>
        ))
      )}
    </Stack>
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
