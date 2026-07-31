import {
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { createImageDraft } from "./api";

const ASPECT_RATIOS = [
  { value: "4:3", label: "게시글 (4:3)" },
  { value: "16:9", label: "스토리 (16:9)" },
];

// ① 요청 입력. 여기서 만들어지는 것은 draft 잡이라 아직 비용이 없다.
export function NewImageRequestForm({
  onCreated,
  onCancel,
}: {
  onCreated: (jobId: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      characterId: "",
      inputPrompt: "",
      aspectRatio: "4:3",
      candidateCount: 3,
    },
    validate: {
      characterId: (value) => (value ? null : "캐릭터를 선택해 주세요"),
      inputPrompt: (value) =>
        value.trim().length === 0 ? "이미지 요청을 입력해 주세요" : null,
    },
  });

  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createImageDraft({
        characterId: values.characterId,
        inputPrompt: values.inputPrompt.trim(),
        candidateCount: values.candidateCount,
        aspectRatio: values.aspectRatio,
      }),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
      onCreated(job.id);
    },
  });

  return (
    <Paper p="md" component="section">
      <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
        <Stack gap="sm">
          <Title order={5}>요청 입력</Title>
          <CharacterSelect
            w={260}
            key={form.key("characterId")}
            {...form.getInputProps("characterId")}
          />
          <Textarea
            label="이미지 요청"
            autosize
            minRows={5}
            key={form.key("inputPrompt")}
            {...form.getInputProps("inputPrompt")}
          />
          <Group align="flex-start" gap="sm">
            <Select
              label="용도 (비율)"
              data={ASPECT_RATIOS}
              allowDeselect={false}
              w={180}
              key={form.key("aspectRatio")}
              {...form.getInputProps("aspectRatio")}
            />
            <NumberInput
              label="후보 수"
              min={1}
              max={4}
              w={120}
              key={form.key("candidateCount")}
              {...form.getInputProps("candidateCount")}
            />
          </Group>

          {create.isError ? (
            <Alert color="red" role="alert" title="만들지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}

          <Group>
            <Button type="submit" loading={create.isPending}>
              최종 프롬프트 확인
            </Button>
            <Button variant="default" type="button" onClick={onCancel}>
              취소
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
