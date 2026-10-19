import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { saveCharacterReferenceLink } from "../characters/api";
import { registerInfluencer, type Influencer } from "./api";
import { LibraryPicker, type PickerOption } from "./LibraryPicker";
import { characterOptions } from "./library-options";

export function AccountModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (account: Influencer) => void;
}) {
  const client = useQueryClient();
  const [character, setCharacter] = useState<PickerOption | null>(null);
  const [saved, setSaved] = useState<Influencer | null>(null);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { url: "" },
    validate: {
      url: (value) =>
        value.trim() ? null : "Instagram 계정 링크를 입력해 주세요.",
    },
  });
  const save = useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      const account = saved ?? (await registerInfluencer(url.trim()));
      setSaved(account);
      if (character)
        await saveCharacterReferenceLink(character.value, account.url);
      return account;
    },
    onSuccess: async (account) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["influencers"] }),
        client.invalidateQueries({ queryKey: ["library-account-options"] }),
        client.invalidateQueries({
          queryKey: ["character-reference-directory"],
        }),
        client.invalidateQueries({ queryKey: ["character"] }),
      ]);
      onAdded(account);
    },
  });
  return (
    <Modal
      opened
      title="SNS 계정 추가"
      onClose={save.isPending ? () => {} : onClose}
      closeOnClickOutside={false}
      closeOnEscape={!save.isPending}
      withCloseButton={!save.isPending}
    >
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="lg">
          <Text size="sm" c="ink.6">
            레퍼런스를 모을 Instagram 계정을 등록하세요.
          </Text>
          <TextInput
            label="Instagram 계정 링크"
            description="게시물이 아닌 계정 프로필 주소를 입력하세요."
            placeholder="https://www.instagram.com/username/"
            required
            data-autofocus
            maxLength={2048}
            disabled={save.isPending || Boolean(saved)}
            key={form.key("url")}
            {...form.getInputProps("url")}
          />
          <LibraryPicker
            label="연결할 캐릭터"
            placeholder="나중에 연결"
            value={character}
            onChange={setCharacter}
            queryKey={["library-character-options"]}
            fetchOptions={characterOptions}
            disabled={save.isPending}
          />
          {save.error ? (
            <Alert
              color="red"
              role="alert"
              title={
                saved
                  ? "계정은 등록됐지만 캐릭터 연결에 실패했습니다"
                  : "계정을 등록하지 못했습니다"
              }
            >
              {save.error.message}
              <Text size="sm">입력을 확인하고 다시 시도하세요.</Text>
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={onClose}
              disabled={save.isPending}
            >
              취소
            </Button>
            <Button type="submit" loading={save.isPending}>
              {saved ? "연결 다시 시도" : "계정 추가"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
