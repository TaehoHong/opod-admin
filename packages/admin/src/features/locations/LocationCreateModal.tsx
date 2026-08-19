import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CharacterListItem } from "../characters/api";
import { createLocation, type LocationInput } from "./api";

export function LocationCreateModal({
  opened,
  characters,
  onClose,
  onCreated,
}: {
  opened: boolean;
  characters: CharacterListItem[];
  onClose: () => void;
  onCreated: (locationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: blankLocation(),
    validate: {
      locationKey: (value) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim())
          ? null
          : "영문 소문자, 숫자, 하이픈으로 입력해 주세요",
      displayName: (value) =>
        value.trim() ? null : "장소 이름을 입력해 주세요",
    },
  });
  const create = useMutation({
    mutationFn: (values: LocationInput) => createLocation(normalize(values)),
    onSuccess: (location) => {
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      form.reset();
      onClose();
      onCreated(location.id);
    },
  });
  const close = () => {
    if (create.isPending) return;
    create.reset();
    form.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="장소 추가" size="lg">
      <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
        <Stack gap="sm">
          <Select
            label="캐릭터"
            description="선택하지 않으면 모든 캐릭터가 쓰는 범용 장소입니다"
            placeholder="범용 장소"
            clearable
            searchable
            data={characters.map((character) => ({
              value: character.id,
              label: `${character.displayName} (@${character.publicId})`,
            }))}
            key={form.key("characterId")}
            {...form.getInputProps("characterId")}
          />
          <TextInput
            label="장소 키"
            placeholder="buldang-gym"
            key={form.key("locationKey")}
            {...form.getInputProps("locationKey")}
          />
          <TextInput
            label="장소 이름"
            key={form.key("displayName")}
            {...form.getInputProps("displayName")}
          />
          <Textarea
            label="설명"
            rows={3}
            key={form.key("description")}
            {...form.getInputProps("description")}
          />
          <Textarea
            label="비주얼 프롬프트"
            rows={4}
            key={form.key("visualPrompt")}
            {...form.getInputProps("visualPrompt")}
          />
          <Textarea
            label="네거티브 프롬프트 (컷 생성에 함께 나감)"
            rows={2}
            key={form.key("negativePrompt")}
            {...form.getInputProps("negativePrompt")}
          />
          <Textarea
            label="레퍼런스 전용 네거티브"
            description="빈 공간 레퍼런스를 만들 때만 쓰는 금지어(people, faces 등). 컷 생성 요청에는 나가지 않습니다."
            rows={2}
            key={form.key("referenceNegativePrompt")}
            {...form.getInputProps("referenceNegativePrompt")}
          />
          {create.isError ? (
            <Alert color="red" role="alert" title="생성하지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
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

export function blankLocation(): LocationInput {
  return {
    characterId: null,
    locationKey: "",
    displayName: "",
    description: "",
    visualPrompt: "",
    negativePrompt: "",
    referenceNegativePrompt: "",
  };
}

export function normalize(values: LocationInput): LocationInput {
  return {
    characterId: values.characterId || null,
    locationKey: values.locationKey.trim(),
    displayName: values.displayName.trim(),
    description: values.description.trim(),
    visualPrompt: values.visualPrompt.trim(),
    negativePrompt: values.negativePrompt.trim(),
    referenceNegativePrompt: values.referenceNegativePrompt.trim(),
  };
}
