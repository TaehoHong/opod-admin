import {
  Alert,
  Button,
  Divider,
  FileInput,
  Group,
  Image,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMediaList, mediaFileName, uploadMediaFile } from "../media/api";
import type { MediaItem } from "../media/api";
import { previewUrl } from "../../shared/media/previewUrl";
import {
  clearCharacterProfileImage,
  deleteCharacter,
  fetchCharacterProfileImage,
  setCharacterProfileImage,
  updateCharacter,
  updateCharacterStatus,
  type CharacterDetail,
} from "./api";

export function CharacterProfilePanel({
  character,
}: {
  character: CharacterDetail;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      displayName: character.displayName,
      bio: character.bio,
      interests: character.interests,
    },
    validate: {
      displayName: required("표시 이름을 입력해 주세요"),
      bio: required("소개를 입력해 주세요"),
    },
  });

  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      updateCharacter(character.id, {
        displayName: values.displayName.trim(),
        bio: values.bio.trim(),
        interests: values.interests
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    onSuccess: () => invalidateCharacter(queryClient, character.id),
  });

  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
      <Paper p="md" component="section">
        <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
          <Stack gap="sm">
            <Title order={5}>기본 프로필</Title>
            <TextInput label="핸들" value={character.publicId} disabled />
            <TextInput
              label="표시 이름"
              key={form.key("displayName")}
              {...form.getInputProps("displayName")}
            />
            <Textarea
              label="소개"
              rows={4}
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
            <MutationState
              mutation={save}
              success="프로필을 저장했습니다."
              errorTitle="프로필을 저장하지 못했습니다"
            />
            <Group>
              <Button type="submit" loading={save.isPending}>
                프로필 저장
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Stack>
        <ProfileImageForm characterId={character.id} />
        <CharacterStatusForm character={character} />
      </Stack>
    </SimpleGrid>
  );
}

function ProfileImageForm({ characterId }: { characterId: string }) {
  const profile = useQuery({
    queryKey: ["character", characterId, "profile-image"],
    queryFn: () => fetchCharacterProfileImage(characterId),
  });
  const media = useQuery({
    queryKey: ["media", "profile-image-options"],
    queryFn: () => fetchMediaList({ mediaType: "image", uploaded: "true" }),
  });

  if (profile.isPending)
    return <Paper p="md">프로필 이미지 불러오는 중…</Paper>;
  if (profile.error) {
    return (
      <Alert
        color="red"
        role="alert"
        title="프로필 이미지를 불러오지 못했습니다"
      >
        {profile.error.message}
      </Alert>
    );
  }
  if (!profile.data) return null;

  return (
    <ProfileImageEditor
      key={`${profile.data.image?.id ?? "empty"}:${profile.data.crop.x}:${
        profile.data.crop.y
      }:${profile.data.crop.zoom}`}
      characterId={characterId}
      profile={profile.data}
      media={media.data?.items ?? []}
      mediaPending={media.isPending}
    />
  );
}

function ProfileImageEditor({
  characterId,
  profile,
  media,
  mediaPending,
}: {
  characterId: string;
  profile: Awaited<ReturnType<typeof fetchCharacterProfileImage>>;
  media: MediaItem[];
  mediaPending: boolean;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const form = useForm<{
    mediaId: string | null;
    cropX: number | string;
    cropY: number | string;
    cropZoom: number | string;
  }>({
    mode: "uncontrolled",
    initialValues: {
      mediaId: profile.image?.id ?? null,
      cropX: profile.crop.x,
      cropY: profile.crop.y,
      cropZoom: profile.crop.zoom,
    },
    validate: {
      mediaId: (value) => (value ? null : "이미지를 선택해 주세요"),
    },
  });

  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      setCharacterProfileImage(characterId, {
        mediaId: values.mediaId ?? "",
        crop: {
          x: Number(values.cropX),
          y: Number(values.cropY),
          zoom: Number(values.cropZoom),
        },
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["character", characterId, "profile-image"],
      }),
  });
  const clear = useMutation({
    mutationFn: () => clearCharacterProfileImage(characterId),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["character", characterId, "profile-image"],
      }),
  });
  const upload = useMutation({
    mutationFn: async (selected: File) => {
      const uploaded = await uploadMediaFile(
        selected,
        "image",
        `pod/profile/character/${characterId}`,
      );
      const values = form.getValues();
      return setCharacterProfileImage(characterId, {
        mediaId: uploaded.id,
        crop: {
          x: Number(values.cropX),
          y: Number(values.cropY),
          zoom: Number(values.cropZoom),
        },
      });
    },
    onSuccess: () => {
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({
        queryKey: ["character", characterId, "profile-image"],
      });
    },
  });

  const source = profile.image ? previewUrl(profile.image.url) : null;

  return (
    <Paper p="md" component="section">
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <Stack gap="sm">
          <Title order={5}>프로필 이미지</Title>
          {source ? (
            <Image
              src={source}
              alt={`${characterId} 프로필 이미지`}
              h={180}
              fit="contain"
            />
          ) : (
            <Text size="sm" c="dimmed">
              설정된 이미지가 없습니다.
            </Text>
          )}
          <Select
            label="업로드 완료 이미지"
            placeholder={mediaPending ? "불러오는 중…" : "선택하세요"}
            searchable
            clearable
            data={media.map((item) => ({
              value: item.id,
              label: mediaFileName(item),
            }))}
            key={form.key("mediaId")}
            {...form.getInputProps("mediaId")}
          />
          <FileInput
            label="새 이미지 업로드"
            description="선택한 파일을 업로드하고 바로 프로필 이미지로 적용합니다"
            accept="image/*"
            value={file}
            onChange={setFile}
            clearable
          />
          <Group grow align="flex-start">
            <NumberInput
              label="가로 위치"
              min={0}
              max={1}
              step={0.01}
              key={form.key("cropX")}
              {...form.getInputProps("cropX")}
            />
            <NumberInput
              label="세로 위치"
              min={0}
              max={1}
              step={0.01}
              key={form.key("cropY")}
              {...form.getInputProps("cropY")}
            />
            <NumberInput
              label="확대"
              min={1}
              max={3}
              step={0.05}
              key={form.key("cropZoom")}
              {...form.getInputProps("cropZoom")}
            />
          </Group>
          <MutationState
            mutation={save}
            success="프로필 이미지를 저장했습니다."
            errorTitle="프로필 이미지를 저장하지 못했습니다"
          />
          <MutationState
            mutation={clear}
            success="프로필 이미지를 제거했습니다."
            errorTitle="프로필 이미지를 제거하지 못했습니다"
          />
          <MutationState
            mutation={upload}
            success="이미지를 업로드하고 프로필에 적용했습니다."
            errorTitle="이미지를 업로드하지 못했습니다"
          />
          <Group>
            <Button type="submit" loading={save.isPending}>
              이미지 적용
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={!file}
              loading={upload.isPending}
              onClick={() => {
                if (file) upload.mutate(file);
              }}
            >
              업로드 후 적용
            </Button>
            {profile.image ? (
              <Button
                type="button"
                variant="default"
                color="red"
                loading={clear.isPending}
                onClick={() => clear.mutate()}
              >
                이미지 제거
              </Button>
            ) : null}
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

function CharacterStatusForm({ character }: { character: CharacterDetail }) {
  const queryClient = useQueryClient();
  const statusForm = useForm({
    mode: "uncontrolled",
    initialValues: { reason: "" },
    validate: { reason: required("변경 사유를 입력해 주세요") },
  });
  const removeForm = useForm({
    mode: "uncontrolled",
    initialValues: { reason: "" },
    validate: { reason: required("비활성화 사유를 입력해 주세요") },
  });
  const status = useMutation({
    mutationFn: (reason: string) =>
      updateCharacterStatus(character.id, {
        status: character.status === "active" ? "inactive" : "active",
        reason: reason.trim(),
      }),
    onSuccess: () => invalidateCharacter(queryClient, character.id),
  });
  const remove = useMutation({
    mutationFn: (reason: string) =>
      deleteCharacter(character.id, reason.trim()),
    onSuccess: () => invalidateCharacter(queryClient, character.id),
  });

  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Title order={5}>상태</Title>
        <Text size="sm">현재 상태: {character.status}</Text>
        <form
          onSubmit={statusForm.onSubmit(({ reason }) => status.mutate(reason))}
        >
          <Stack gap="xs">
            <TextInput
              label="상태 변경 사유"
              key={statusForm.key("reason")}
              {...statusForm.getInputProps("reason")}
            />
            <Button type="submit" variant="default" loading={status.isPending}>
              {character.status === "active" ? "비활성화" : "활성화"}
            </Button>
          </Stack>
        </form>
        <MutationState
          mutation={status}
          success="상태를 변경했습니다."
          errorTitle="상태를 변경하지 못했습니다"
        />
        {character.status === "active" ? (
          <>
            <Divider />
            <form
              onSubmit={removeForm.onSubmit(({ reason }) =>
                remove.mutate(reason),
              )}
            >
              <Stack gap="xs">
                <TextInput
                  label="캐릭터 삭제 사유"
                  description="데이터는 보존하고 캐릭터를 비활성화합니다"
                  key={removeForm.key("reason")}
                  {...removeForm.getInputProps("reason")}
                />
                <Button type="submit" color="red" loading={remove.isPending}>
                  캐릭터 삭제
                </Button>
              </Stack>
            </form>
            <MutationState
              mutation={remove}
              success="캐릭터를 비활성화했습니다."
              errorTitle="캐릭터를 삭제하지 못했습니다"
            />
          </>
        ) : null}
      </Stack>
    </Paper>
  );
}

function MutationState({
  mutation,
  success,
  errorTitle,
}: {
  mutation: { isError: boolean; isSuccess: boolean; error: Error | null };
  success: string;
  errorTitle: string;
}) {
  if (mutation.isError) {
    return (
      <Alert color="red" role="alert" title={errorTitle}>
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

function invalidateCharacter(
  queryClient: ReturnType<typeof useQueryClient>,
  characterId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["character", characterId] });
  void queryClient.invalidateQueries({ queryKey: ["characters"] });
  void queryClient.invalidateQueries({ queryKey: ["character-options"] });
}
