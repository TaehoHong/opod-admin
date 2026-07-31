import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import {
  createPostComment,
  createPostReaction,
  type PostCommentCreate,
  type PostReactionCreate,
} from "./api";

export type PostInteraction = {
  postId: string;
  mode: "comment" | "reaction";
};

type FormValues = {
  characterId: string;
  body: string;
  reactionType: string;
  reason: string;
};

export function PostInteractionModal({
  interaction,
  onClose,
}: {
  interaction: PostInteraction | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    mode: "uncontrolled",
    initialValues: {
      characterId: "",
      body: "",
      reactionType: "like",
      reason: "",
    },
    validate: {
      characterId: required("캐릭터를 선택해 주세요"),
      body: (value) =>
        interaction?.mode === "comment" && !value.trim()
          ? "댓글 내용을 입력해 주세요"
          : null,
      reactionType: (value) =>
        interaction?.mode === "reaction" && !value.trim()
          ? "반응 타입을 선택해 주세요"
          : null,
    },
  });

  const submit = useMutation({
    mutationFn: (values: FormValues) => {
      if (!interaction) throw new Error("대상 게시글이 없습니다");
      return interaction.mode === "comment"
        ? createPostComment(interaction.postId, toCommentBody(values))
        : createPostReaction(interaction.postId, toReactionBody(values));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      form.reset();
      onClose();
    },
  });

  const close = () => {
    if (submit.isPending) return;
    submit.reset();
    form.reset();
    onClose();
  };
  const isComment = interaction?.mode === "comment";

  return (
    <Modal
      opened={interaction !== null}
      onClose={close}
      title={isComment ? "캐릭터 명의 댓글" : "캐릭터 명의 반응"}
      size="md"
    >
      <form
        onSubmit={form.onSubmit((values) => {
          if (!submit.isPending) submit.mutate(values);
        })}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            대상 게시물: {interaction?.postId}
          </Text>
          <CharacterSelect
            label={isComment ? "댓글 작성 캐릭터" : "반응 캐릭터"}
            key={form.key("characterId")}
            {...form.getInputProps("characterId")}
          />
          {isComment ? (
            <Textarea
              label="댓글 내용"
              rows={3}
              key={form.key("body")}
              {...form.getInputProps("body")}
            />
          ) : (
            <Select
              label="반응 타입"
              data={[{ value: "like", label: "like" }]}
              allowDeselect={false}
              key={form.key("reactionType")}
              {...form.getInputProps("reactionType")}
            />
          )}
          <TextInput
            label="로그 이유"
            key={form.key("reason")}
            {...form.getInputProps("reason")}
          />
          {submit.isError ? (
            <Alert color="red" role="alert" title="저장하지 못했습니다">
              {submit.error.message}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              type="button"
              onClick={close}
              disabled={submit.isPending}
            >
              취소
            </Button>
            <Button type="submit" loading={submit.isPending}>
              {isComment ? "댓글 생성" : "반응 생성"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function required(message: string) {
  return (value: string) => (value.trim() ? null : message);
}

function toCommentBody(values: FormValues): PostCommentCreate {
  const reason = values.reason.trim();
  return {
    characterId: values.characterId,
    body: values.body.trim(),
    ...(reason ? { reason } : {}),
  };
}

function toReactionBody(values: FormValues): PostReactionCreate {
  const reason = values.reason.trim();
  return {
    characterId: values.characterId,
    reactionType: values.reactionType,
    ...(reason ? { reason } : {}),
  };
}
