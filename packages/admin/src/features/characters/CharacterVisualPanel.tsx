import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Loader,
  MultiSelect,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchMediaList,
  mediaFileName,
  uploadMediaFile,
  type MediaItem,
} from "../media/api";
import { fetchGenerationJobs } from "../generation/api";
import { previewUrl } from "../../shared/media/previewUrl";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import {
  captionVisualProfileReferences,
  enqueueVisualProfileTest,
  fetchVisualProfile,
  setVisualProfileReferences,
  updateVisualProfile,
  type VisualProfile,
} from "./api";

export function CharacterVisualPanel({ characterId }: { characterId: string }) {
  const [editing, setEditing] = useState(false);
  const profile = useQuery({
    queryKey: ["character", characterId, "visual-profile"],
    queryFn: () => fetchVisualProfile(characterId),
  });
  const media = useQuery({
    queryKey: ["media", "visual-reference-options"],
    queryFn: () => fetchMediaList({ mediaType: "image", uploaded: "true" }),
  });

  if (profile.isPending) {
    return <Loader aria-label="비주얼 프로필 불러오는 중" />;
  }
  if (profile.error) {
    return (
      <Alert
        color="red"
        role="alert"
        title="비주얼 프로필을 불러오지 못했습니다"
      >
        {profile.error.message}
      </Alert>
    );
  }
  if (!profile.data) return null;

  if (!editing) {
    return (
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Title order={4}>비주얼 프로필</Title>
            <Text size="sm" c="dimmed">
              이미지 생성에 사용하는 외형·스타일·레퍼런스
            </Text>
          </Stack>
          <Button onClick={() => setEditing(true)}>비주얼 수정</Button>
        </Group>
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <Paper p="md" component="section">
            <Stack gap="md">
              <PromptSummary
                label="외모"
                value={profile.data.appearancePrompt}
              />
              <PromptSummary label="스타일" value={profile.data.stylePrompt} />
              <PromptSummary
                label="제외 요소"
                value={profile.data.negativePrompt}
              />
            </Stack>
          </Paper>
          <Paper p="md" component="section">
            <Stack gap="sm">
              <Group justify="space-between">
                <Title order={5}>레퍼런스</Title>
                <Badge variant="light" color="ink">
                  {
                    profile.data.referenceMedia.filter((item) => item.isActive)
                      .length
                  }
                  개 활성
                </Badge>
              </Group>
              {profile.data.referenceMedia.length ? (
                <SimpleGrid cols={{ base: 2, sm: 3 }}>
                  {profile.data.referenceMedia.map((reference) => {
                    const source = previewUrl(reference.url);
                    return (
                      <Stack key={reference.mediaId} gap={4}>
                        <Badge
                          color={reference.isActive ? "teal" : "gray"}
                          variant="light"
                          size="xs"
                        >
                          {reference.isActive ? "활성" : "비활성"}
                        </Badge>
                        {source ? (
                          <ZoomableImage
                            src={source}
                            alt="캐릭터 레퍼런스"
                            h={120}
                            fit="cover"
                            style={{ opacity: reference.isActive ? 1 : 0.45 }}
                          />
                        ) : null}
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {reference.description || "설명 없음"}
                        </Text>
                      </Stack>
                    );
                  })}
                </SimpleGrid>
              ) : (
                <Text size="sm" c="dimmed">
                  등록된 레퍼런스가 없습니다.
                </Text>
              )}
            </Stack>
          </Paper>
        </SimpleGrid>
      </Stack>
    );
  }

  return (
    <VisualProfileForms
      key={`${profile.data.updatedAt ?? "new"}:${profile.data.referenceMedia
        .map((item) => `${item.mediaId}:${item.isActive}`)
        .join(",")}`}
      characterId={characterId}
      profile={profile.data}
      media={media.data?.items ?? []}
      mediaPending={media.isPending}
      onDone={() => setEditing(false)}
    />
  );
}

function PromptSummary({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={3}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
        {value || "설정 없음"}
      </Text>
    </Stack>
  );
}

function VisualProfileForms({
  characterId,
  profile,
  media,
  mediaPending,
  onDone,
}: {
  characterId: string;
  profile: VisualProfile;
  media: MediaItem[];
  mediaPending: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const prompts = useForm({
    mode: "uncontrolled",
    initialValues: {
      appearancePrompt: profile.appearancePrompt,
      stylePrompt: profile.stylePrompt,
      negativePrompt: profile.negativePrompt,
    },
  });
  const references = useForm({
    mode: "uncontrolled",
    initialValues: {
      mediaIds: profile.referenceMedia
        .filter((item) => item.isActive)
        .map((item) => item.mediaId),
    },
  });
  const test = useForm({
    mode: "uncontrolled",
    initialValues: { scene: "" },
  });

  const savePrompts = useMutation({
    mutationFn: (values: typeof prompts.values) =>
      updateVisualProfile(characterId, {
        appearancePrompt: values.appearancePrompt.trim(),
        stylePrompt: values.stylePrompt.trim(),
        negativePrompt: values.negativePrompt.trim(),
      }),
    onSuccess: () => {
      onDone();
      invalidate(queryClient, characterId);
    },
  });
  const saveReferences = useMutation({
    mutationFn: (mediaIds: string[]) =>
      setVisualProfileReferences(characterId, mediaIds),
    onSuccess: () => {
      onDone();
      invalidate(queryClient, characterId);
    },
  });
  const caption = useMutation({
    mutationFn: () => captionVisualProfileReferences(characterId),
    onSuccess: () => invalidate(queryClient, characterId),
  });
  const enqueue = useMutation({
    mutationFn: (scene: string) =>
      enqueueVisualProfileTest(characterId, scene.trim()),
    onSuccess: () => test.reset(),
  });
  const uploadReference = useMutation({
    mutationFn: async (selected: File) => {
      const uploaded = await uploadMediaFile(
        selected,
        "image",
        `pod/reference/character/${characterId}`,
      );
      const mediaIds = references.getValues().mediaIds;
      return setVisualProfileReferences(characterId, [
        ...new Set([...mediaIds, uploaded.id]),
      ]);
    },
    onSuccess: () => {
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      invalidate(queryClient, characterId);
    },
  });

  const options = media.map((item) => ({
    value: item.id,
    label: mediaFileName(item),
  }));
  for (const reference of profile.referenceMedia) {
    if (!options.some((item) => item.value === reference.mediaId)) {
      options.push({ value: reference.mediaId, label: reference.mediaId });
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={4}>비주얼 프로필 수정</Title>
          <Text size="sm" c="dimmed">
            저장하지 않은 변경은 취소할 수 있습니다.
          </Text>
        </Stack>
        <Button variant="default" onClick={onDone}>
          편집 닫기
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Stack>
          <Paper p="md" component="section">
            <form
              onSubmit={prompts.onSubmit((values) =>
                savePrompts.mutate(values),
              )}
            >
              <Stack gap="sm">
                <Title order={5}>비주얼 프롬프트</Title>
                <Textarea
                  label="외모 프롬프트"
                  rows={3}
                  key={prompts.key("appearancePrompt")}
                  {...prompts.getInputProps("appearancePrompt")}
                />
                <Textarea
                  label="스타일 프롬프트"
                  rows={3}
                  key={prompts.key("stylePrompt")}
                  {...prompts.getInputProps("stylePrompt")}
                />
                <Textarea
                  label="네거티브 프롬프트"
                  rows={2}
                  key={prompts.key("negativePrompt")}
                  {...prompts.getInputProps("negativePrompt")}
                />
                <MutationAlert
                  mutation={savePrompts}
                  success="비주얼 프로필을 저장했습니다."
                />
                <Button type="submit" loading={savePrompts.isPending}>
                  비주얼 프로필 저장
                </Button>
              </Stack>
            </form>
          </Paper>
          <Paper p="md" component="section">
            <form
              onSubmit={test.onSubmit(({ scene }) => enqueue.mutate(scene))}
            >
              <Stack gap="sm">
                <Title order={5}>테스트 생성</Title>
                <TextInput
                  label="장면 설명"
                  placeholder="노을 지는 해변 산책"
                  key={test.key("scene")}
                  {...test.getInputProps("scene")}
                />
                <MutationAlert
                  mutation={enqueue}
                  success={`생성 큐에 등록했습니다${
                    enqueue.data?.jobId ? ` (${enqueue.data.jobId})` : ""
                  }.`}
                />
                <Button type="submit" loading={enqueue.isPending}>
                  생성 큐 등록
                </Button>
              </Stack>
            </form>
            <RecentGenerations
              characterId={characterId}
              referenceMediaIds={profile.referenceMedia
                .filter((item) => item.isActive)
                .map((item) => item.mediaId)}
            />
          </Paper>
        </Stack>

        <Paper p="md" component="section">
          <form
            onSubmit={references.onSubmit(({ mediaIds }) =>
              saveReferences.mutate(mediaIds),
            )}
          >
            <Stack gap="sm">
              <Title order={5}>레퍼런스 이미지</Title>
              <MultiSelect
                label="활성 레퍼런스"
                description="선택 해제하면 삭제하지 않고 비활성화합니다. 최대 20개"
                data={options}
                searchable
                maxValues={20}
                disabled={mediaPending}
                key={references.key("mediaIds")}
                {...references.getInputProps("mediaIds")}
              />
              <FileInput
                label="새 레퍼런스 업로드"
                accept="image/*"
                value={file}
                onChange={setFile}
                clearable
              />
              <Group>
                <Button type="submit" loading={saveReferences.isPending}>
                  레퍼런스 저장
                </Button>
                <Button
                  type="button"
                  variant="default"
                  loading={caption.isPending}
                  disabled={
                    !profile.referenceMedia.some((item) => item.isActive)
                  }
                  onClick={() => caption.mutate()}
                >
                  빈 캡션 생성
                </Button>
                <Button
                  type="button"
                  variant="default"
                  disabled={!file}
                  loading={uploadReference.isPending}
                  onClick={() => {
                    if (file) uploadReference.mutate(file);
                  }}
                >
                  업로드 추가
                </Button>
              </Group>
              <MutationAlert
                mutation={saveReferences}
                success="레퍼런스를 저장했습니다."
              />
              <MutationAlert
                mutation={caption}
                success={`캡션 ${caption.data?.captioned ?? 0}장을 생성했습니다.`}
              />
              <MutationAlert
                mutation={uploadReference}
                success="레퍼런스를 업로드하고 추가했습니다."
              />
              {profile.referenceMedia.length === 0 ? (
                <Text size="sm" c="dimmed">
                  레퍼런스가 없습니다.
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 2, sm: 3 }}>
                  {profile.referenceMedia.map((reference) => {
                    const source = previewUrl(reference.url);
                    return (
                      <Stack key={reference.mediaId} gap={4}>
                        <Badge
                          color={reference.isActive ? "teal" : "gray"}
                          variant="light"
                          size="xs"
                        >
                          {reference.isActive ? "활성" : "비활성"}
                        </Badge>
                        {source ? (
                          <ZoomableImage
                            src={source}
                            alt="캐릭터 레퍼런스"
                            h={120}
                            fit="cover"
                            style={{ opacity: reference.isActive ? 1 : 0.45 }}
                          />
                        ) : null}
                        <Text size="xs" c="dimmed" lineClamp={3}>
                          {reference.description || "캡션 없음"}
                        </Text>
                      </Stack>
                    );
                  })}
                </SimpleGrid>
              )}
            </Stack>
          </form>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}

// 테스트 생성은 결과를 봐야 의미가 있고, 쓸 만한 결과는 레퍼런스로 올려야
// 다음 생성에 반영된다. 큐에 넣고 끝나면 그 결과를 찾으러 생성 화면으로 나가야
// 한다.
function RecentGenerations({
  characterId,
  referenceMediaIds,
}: {
  characterId: string;
  referenceMediaIds: string[];
}) {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ["generation", "character", characterId],
    queryFn: () => fetchGenerationJobs({ characterId, limit: "10" }),
  });

  const promote = useMutation({
    mutationFn: (mediaId: string) =>
      setVisualProfileReferences(characterId, [
        ...new Set([...referenceMediaIds, mediaId]),
      ]),
    onSuccess: () => invalidate(queryClient, characterId),
  });

  const items = jobs.data?.items ?? [];

  return (
    <Stack gap="xs" mt="lg">
      <Title order={6}>최근 생성</Title>
      <MutationAlert mutation={promote} success="레퍼런스로 승격했습니다." />
      {jobs.isPending ? (
        <Loader size="sm" aria-label="최근 생성 불러오는 중" />
      ) : items.length === 0 ? (
        <Text size="sm" c="dimmed">
          생성 이력이 없습니다.
        </Text>
      ) : (
        items.map((job) => {
          const mediaId =
            job.outputMediaId ??
            job.outputs?.find((output) => output.selected)?.mediaId ??
            job.outputs?.[0]?.mediaId;
          const output = job.outputs?.find(
            (candidate) => candidate.mediaId === mediaId,
          );
          const source = output ? previewUrl(output.url) : null;
          const promotable =
            job.status === "completed" &&
            mediaId !== undefined &&
            !referenceMediaIds.includes(mediaId);

          return (
            <Group key={job.id} gap="sm" wrap="nowrap" align="center">
              {source ? (
                <ZoomableImage
                  src={source}
                  alt={`생성 결과 ${job.id}`}
                  w={44}
                  h={44}
                  fit="cover"
                />
              ) : null}
              <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                {job.prompt}
              </Text>
              <Badge color={JOB_STATUS_COLOR[job.status] ?? "gray"}>
                {job.status}
              </Badge>
              {promotable ? (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  loading={promote.isPending && promote.variables === mediaId}
                  onClick={() => promote.mutate(mediaId)}
                >
                  승격
                </Button>
              ) : referenceMediaIds.includes(mediaId ?? "") ? (
                <Text size="xs" c="dimmed">
                  레퍼런스
                </Text>
              ) : null}
            </Group>
          );
        })
      )}
    </Stack>
  );
}

const JOB_STATUS_COLOR: Record<string, string> = {
  draft: "ink",
  queued: "attention",
  running: "accent",
  completed: "teal",
  failed: "red",
};

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  characterId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: ["character", characterId, "visual-profile"],
  });
}
