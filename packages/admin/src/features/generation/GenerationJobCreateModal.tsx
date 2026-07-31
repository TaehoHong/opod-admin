import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { enqueueGenerationJob, type EnqueueGenerationJobInput } from "./api";

export function GenerationJobCreateModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<EnqueueGenerationJobInput>({
    mode: "uncontrolled",
    initialValues: {
      characterId: "",
      mediaType: "image",
      prompt: "",
    },
    validate: {
      characterId: (value) => (value ? null : "캐릭터를 선택해 주세요"),
      prompt: (value) =>
        value.trim().length === 0 ? "프롬프트를 입력해 주세요" : null,
    },
  });

  const create = useMutation({
    mutationFn: (values: EnqueueGenerationJobInput) =>
      enqueueGenerationJob({
        ...values,
        prompt: values.prompt.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
      form.reset();
      onClose();
    },
  });

  const close = () => {
    if (create.isPending) return;
    create.reset();
    form.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="생성 작업 큐 등록" centered>
      <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
        <Stack gap="sm">
          <CharacterSelect
            key={form.key("characterId")}
            {...form.getInputProps("characterId")}
          />
          <Select
            label="미디어 타입"
            data={["image", "video"]}
            allowDeselect={false}
            key={form.key("mediaType")}
            {...form.getInputProps("mediaType")}
          />
          <Textarea
            label="프롬프트"
            minRows={4}
            key={form.key("prompt")}
            {...form.getInputProps("prompt")}
          />

          {create.isError ? (
            <Alert color="red" role="alert" title="등록하지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}

          <Group justify="flex-end">
            <Button variant="default" type="button" onClick={close}>
              취소
            </Button>
            <Button type="submit" loading={create.isPending}>
              큐 등록
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
