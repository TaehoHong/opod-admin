import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  Select,
  Stack,
  TagsInput,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadMediaFile, type MediaType } from "../media/api";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { createPost, type PostCreate, type PostContentType } from "./api";

const CONTENT_TYPES = [
  { value: "feed", label: "피드" },
  { value: "reel", label: "릴" },
];

type FormValues = {
  actorId: string;
  contentType: Exclude<PostContentType, "story">;
  content: string;
  hashtags: string[];
  reason: string;
  mediaFiles: File[];
};

export function PostCreateModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    mode: "uncontrolled",
    initialValues: {
      actorId: "",
      contentType: "feed",
      content: "",
      hashtags: [],
      reason: "",
      mediaFiles: [],
    },
    validate: {
      actorId: required("작성 캐릭터를 선택해 주세요"),
      content: required("본문을 입력해 주세요"),
      reason: required("로그 이유를 입력해 주세요"),
      mediaFiles: (files) =>
        files.length === 0
          ? "이미지 또는 영상을 하나 이상 선택해 주세요"
          : files.every(isSupportedMedia)
            ? null
            : "이미지 또는 영상 파일만 선택할 수 있습니다",
    },
  });

  const create = useMutation({
    mutationFn: async (values: FormValues) =>
      createPost(await toCreateBody(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
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
    <Modal opened={opened} onClose={close} title="새 게시글" size="lg">
      <form
        onSubmit={form.onSubmit((values) => {
          if (!create.isPending) create.mutate(values);
        })}
      >
        <Stack gap="sm">
          <CharacterSelect
            label="작성 캐릭터"
            key={form.key("actorId")}
            {...form.getInputProps("actorId")}
          />
          <Select
            label="콘텐츠 형식"
            data={CONTENT_TYPES}
            allowDeselect={false}
            key={form.key("contentType")}
            {...form.getInputProps("contentType")}
          />
          <Textarea
            label="본문"
            rows={4}
            key={form.key("content")}
            {...form.getInputProps("content")}
          />
          <TagsInput
            label="해시태그"
            description="쉼표 또는 Enter로 구분합니다"
            splitChars={[","]}
            key={form.key("hashtags")}
            {...form.getInputProps("hashtags")}
          />
          <TextInput
            label="로그 이유"
            key={form.key("reason")}
            {...form.getInputProps("reason")}
          />
          <FileInput
            label="미디어"
            description="이미지 또는 영상 파일을 하나 이상 선택합니다"
            accept="image/*,video/*"
            multiple
            clearable
            key={form.key("mediaFiles")}
            {...form.getInputProps("mediaFiles")}
          />
          {create.isError ? (
            <Alert color="red" role="alert" title="게시하지 못했습니다">
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
              게시
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

async function toCreateBody(values: FormValues): Promise<PostCreate> {
  const media: Array<{ mediaId: string }> = [];
  for (const file of values.mediaFiles) {
    const uploaded = await uploadMediaFile(
      file,
      mediaTypeFor(file),
      contentStoragePrefix(values.contentType, values.actorId),
    );
    media.push({ mediaId: uploaded.id });
  }

  return {
    actorType: "character",
    actorId: values.actorId,
    contentType: values.contentType,
    content: values.content.trim(),
    hashtags: values.hashtags.map((value) => value.trim()).filter(Boolean),
    reason: values.reason.trim(),
    media,
  };
}

function mediaTypeFor(file: File): MediaType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  throw new Error(`${file.name}은 이미지 또는 영상 파일이어야 합니다`);
}

function isSupportedMedia(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

function contentStoragePrefix(
  contentType: Exclude<PostContentType, "story">,
  characterId: string,
) {
  return contentType === "feed"
    ? `pod/feed/character/${characterId}`
    : `pod/reels/character/${characterId}`;
}
