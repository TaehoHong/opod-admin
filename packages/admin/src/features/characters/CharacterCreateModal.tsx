import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  TagsInput,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCharacter, type CharacterCreate } from "./api";

export function CharacterCreateModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: (characterId: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      publicId: "",
      displayName: "",
      bio: "",
      interests: [] as string[],
    },
    validate: {
      publicId: required("핸들을 입력해 주세요"),
      displayName: required("표시 이름을 입력해 주세요"),
      bio: required("소개를 입력해 주세요"),
    },
  });

  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createCharacter(toCreateBody(values)),
    onSuccess: (character) => {
      void queryClient.invalidateQueries({ queryKey: ["characters"] });
      void queryClient.invalidateQueries({ queryKey: ["character-options"] });
      form.reset();
      onClose();
      onCreated(character.id);
    },
  });

  const close = () => {
    if (create.isPending) return;
    create.reset();
    form.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="캐릭터 추가" size="lg">
      <form
        onSubmit={form.onSubmit((values) => {
          if (!create.isPending) create.mutate(values);
        })}
      >
        <Stack gap="sm">
          <TextInput
            label="핸들"
            placeholder="영문 식별자"
            key={form.key("publicId")}
            {...form.getInputProps("publicId")}
          />
          <TextInput
            label="표시 이름"
            key={form.key("displayName")}
            {...form.getInputProps("displayName")}
          />
          <Textarea
            label="소개"
            rows={3}
            key={form.key("bio")}
            {...form.getInputProps("bio")}
          />
          <TagsInput
            label="관심사"
            description="쉼표 또는 Enter로 구분합니다"
            splitChars={[","]}
            key={form.key("interests")}
            {...form.getInputProps("interests")}
          />
          {create.isError ? (
            <Alert color="red" role="alert" title="생성하지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              type="button"
              onClick={close}
              disabled={create.isPending}
            >
              취소
            </Button>
            <Button type="submit" loading={create.isPending}>
              생성
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

function toCreateBody(values: {
  publicId: string;
  displayName: string;
  bio: string;
  interests: string[];
}): CharacterCreate {
  return {
    publicId: values.publicId.trim(),
    displayName: values.displayName.trim(),
    bio: values.bio.trim(),
    interests: values.interests.map((value) => value.trim()).filter(Boolean),
  };
}
