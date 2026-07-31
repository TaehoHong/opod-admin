import { Alert, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  completeGenerationJob,
  type CompleteGenerationJobInput,
  type GenerationJob,
} from "./api";

type CompletionValues = {
  mediaId: string;
  url: string;
};

export function GenerationJobCompleteModal({
  job,
  onClose,
}: {
  job: GenerationJob | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CompletionValues>({
    mode: "uncontrolled",
    initialValues: { mediaId: "", url: "" },
    validate: {
      mediaId: (_value, values) =>
        values.mediaId.trim() || values.url.trim()
          ? null
          : "미디어 ID 또는 출력 URL을 입력해 주세요",
    },
  });

  const complete = useMutation({
    mutationFn: (body: CompleteGenerationJobInput) =>
      completeGenerationJob(job!.id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
      form.reset();
      onClose();
    },
  });

  const close = () => {
    if (complete.isPending) return;
    complete.reset();
    form.reset();
    onClose();
  };

  const submit = (values: CompletionValues) => {
    const mediaId = values.mediaId.trim();
    const url = values.url.trim();
    complete.mutate(mediaId ? { mediaId } : { url });
  };

  return (
    <Modal
      opened={job !== null}
      onClose={close}
      title="생성 작업 완료 처리"
      centered
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="sm">
          <TextInput
            label="미디어 ID"
            description="이미 업로드된 미디어를 결과로 연결할 때 입력합니다."
            key={form.key("mediaId")}
            {...form.getInputProps("mediaId")}
          />
          <TextInput
            label="출력 URL"
            type="url"
            description="미디어 ID가 없을 때 생성 결과 URL을 입력합니다."
            key={form.key("url")}
            {...form.getInputProps("url")}
          />

          {complete.isError ? (
            <Alert color="red" role="alert" title="완료 처리하지 못했습니다">
              {complete.error.message}
            </Alert>
          ) : null}

          <Group justify="flex-end">
            <Button variant="default" type="button" onClick={close}>
              취소
            </Button>
            <Button type="submit" loading={complete.isPending}>
              완료 처리
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
