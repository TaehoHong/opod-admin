import {
  Alert,
  Button,
  FileInput,
  Group,
  Image,
  Modal,
  Paper,
  Select,
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
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { previewUrl } from "../../shared/media/previewUrl";
import { DataPage } from "../../shared/ui/DataPage";
import { fetchCharacters } from "../characters/api";
import { uploadMediaFile } from "../media/api";
import { normalize } from "./LocationCreateModal";
import {
  deleteLocation,
  fetchLocation,
  setLocationReferences,
  updateLocation,
  type LocationInput,
  type LocationReference,
} from "./api";

export function LocationManagerPage() {
  const { locationId } = useParams();
  const location = useQuery({
    queryKey: ["location", locationId],
    queryFn: () => fetchLocation(locationId!),
    enabled: Boolean(locationId),
  });
  const characters = useQuery({
    queryKey: ["character-options"],
    queryFn: () => fetchCharacters({ limit: "50" }),
  });
  if (!locationId) return <Navigate to="/locations" replace />;

  return (
    <DataPage
      title={location.data?.displayName ?? "장소 관리"}
      isPending={location.isPending}
      error={location.error}
      actions={
        <Button component={Link} to="/locations" variant="default">
          목록으로
        </Button>
      }
    >
      {location.data ? (
        <LocationForms
          key={`${location.data.updatedAt}:${location.data.references
            .map((item) => `${item.mediaId}:${item.sortOrder}`)
            .join(",")}`}
          location={location.data}
          characters={characters.data?.items ?? []}
        />
      ) : null}
    </DataPage>
  );
}

function LocationForms({
  location,
  characters,
}: {
  location: Awaited<ReturnType<typeof fetchLocation>>;
  characters: Awaited<ReturnType<typeof fetchCharacters>>["items"];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState(location.references);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const form = useForm<LocationInput>({
    mode: "uncontrolled",
    initialValues: {
      characterId: location.characterId,
      locationKey: location.locationKey,
      displayName: location.displayName,
      description: location.description,
      visualPrompt: location.visualPrompt,
      negativePrompt: location.negativePrompt,
      referenceNegativePrompt: location.referenceNegativePrompt,
    },
    validate: {
      locationKey: (value) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim())
          ? null
          : "영문 소문자, 숫자, 하이픈으로 입력해 주세요",
      displayName: (value) =>
        value.trim() ? null : "장소 이름을 입력해 주세요",
    },
  });
  const save = useMutation({
    mutationFn: (values: LocationInput) =>
      updateLocation(location.id, normalize(values)),
    onSuccess: () => invalidate(queryClient, location.id),
  });
  const saveReferences = useMutation({
    mutationFn: (items: LocationReference[]) =>
      setLocationReferences(
        location.id,
        items.map(({ mediaId, description }) => ({ mediaId, description })),
      ),
    onSuccess: (updated) => {
      setReferences(updated.references);
      invalidate(queryClient, location.id);
    },
  });
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const uploaded = [];
      for (const file of selected) {
        uploaded.push(
          await uploadMediaFile(
            file,
            "image",
            `pod/reference/location/${location.id}`,
          ),
        );
      }
      return setLocationReferences(location.id, [
        ...references.map(({ mediaId, description }) => ({
          mediaId,
          description,
        })),
        ...uploaded.map((media) => ({ mediaId: media.id, description: "" })),
      ]);
    },
    onSuccess: (updated) => {
      setFiles([]);
      setReferences(updated.references);
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      invalidate(queryClient, location.id);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteLocation(location.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      navigate("/locations", { replace: true });
    },
  });

  const move = (index: number, direction: -1 | 1) => {
    const next = [...references];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setReferences(next);
  };

  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
      <Paper p="md" component="section">
        <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
          <Stack gap="sm">
            <Title order={5}>장소 정보</Title>
            <Select
              label="캐릭터"
              description="선택하지 않으면 범용 장소입니다"
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
              rows={4}
              key={form.key("description")}
              {...form.getInputProps("description")}
            />
            <Textarea
              label="비주얼 프롬프트"
              rows={6}
              key={form.key("visualPrompt")}
              {...form.getInputProps("visualPrompt")}
            />
            <Textarea
              label="네거티브 프롬프트 (컷 생성에 함께 나감)"
              rows={3}
              key={form.key("negativePrompt")}
              {...form.getInputProps("negativePrompt")}
            />
            <Textarea
              label="레퍼런스 전용 네거티브"
              description="빈 공간 레퍼런스를 만들 때만 쓰는 금지어(people, faces 등). 컷 생성 요청에는 나가지 않습니다."
              rows={3}
              key={form.key("referenceNegativePrompt")}
              {...form.getInputProps("referenceNegativePrompt")}
            />
            <MutationAlert
              mutation={save}
              success="장소 정보를 저장했습니다."
            />
            <Group justify="space-between">
              <Button
                type="button"
                color="red"
                variant="light"
                onClick={() => setDeleteOpen(true)}
              >
                장소 삭제
              </Button>
              <Button type="submit" loading={save.isPending}>
                장소 정보 저장
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Paper p="md" component="section">
        <Stack gap="sm">
          <Title order={5}>레퍼런스 이미지</Title>
          <FileInput
            label="이미지 업로드"
            description="여러 장을 선택할 수 있으며 최대 20장까지 연결됩니다"
            accept="image/*"
            multiple
            value={files}
            onChange={setFiles}
            clearable
          />
          <Button
            variant="default"
            disabled={
              files.length === 0 || references.length + files.length > 20
            }
            loading={upload.isPending}
            onClick={() => upload.mutate(files)}
          >
            선택 이미지 업로드
          </Button>
          <MutationAlert mutation={upload} success="이미지를 업로드했습니다." />
          {references.length === 0 ? (
            <Text size="sm" c="dimmed">
              연결된 레퍼런스가 없습니다.
            </Text>
          ) : (
            <Stack>
              {references.map((reference, index) => {
                const source = previewUrl(reference.url);
                return (
                  <Paper key={reference.mediaId} p="sm" withBorder>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      {source ? (
                        <Image
                          src={source}
                          alt={`${location.displayName} 레퍼런스 ${index + 1}`}
                          h={180}
                          fit="cover"
                        />
                      ) : (
                        <Text size="sm" c="dimmed">
                          미리보기를 표시할 수 없습니다.
                        </Text>
                      )}
                      <Stack gap="xs">
                        <Textarea
                          label={`이미지 ${index + 1} 설명`}
                          rows={4}
                          value={reference.description}
                          onChange={(event) => {
                            const next = [...references];
                            next[index] = {
                              ...reference,
                              description: event.currentTarget.value,
                            };
                            setReferences(next);
                          }}
                        />
                        <Group gap="xs">
                          <Button
                            size="xs"
                            variant="default"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            위로
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            disabled={index === references.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            아래로
                          </Button>
                          <Button
                            size="xs"
                            color="red"
                            variant="subtle"
                            onClick={() =>
                              setReferences(
                                references.filter(
                                  (item) => item.mediaId !== reference.mediaId,
                                ),
                              )
                            }
                          >
                            연결 해제
                          </Button>
                        </Group>
                      </Stack>
                    </SimpleGrid>
                  </Paper>
                );
              })}
            </Stack>
          )}
          <MutationAlert
            mutation={saveReferences}
            success="레퍼런스 순서와 설명을 저장했습니다."
          />
          <Button
            loading={saveReferences.isPending}
            onClick={() => saveReferences.mutate(references)}
          >
            레퍼런스 저장
          </Button>
        </Stack>
      </Paper>

      <Modal
        opened={deleteOpen}
        onClose={() => !remove.isPending && setDeleteOpen(false)}
        title="장소 삭제"
      >
        <Stack>
          <Text>
            {location.displayName}을 목록과 새 게시물 생성 선택지에서 숨깁니다.
            기존 미디어와 초안은 보존됩니다.
          </Text>
          <MutationAlert mutation={remove} success="장소를 삭제했습니다." />
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={remove.isPending}
              onClick={() => setDeleteOpen(false)}
            >
              취소
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              삭제
            </Button>
          </Group>
        </Stack>
      </Modal>
    </SimpleGrid>
  );
}

function MutationAlert({
  mutation,
  success,
}: {
  mutation: { isError: boolean; isSuccess: boolean; error: Error | null };
  success: string;
}) {
  if (mutation.isError) {
    return (
      <Alert color="red" role="alert">
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

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  locationId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["location", locationId] });
  void queryClient.invalidateQueries({ queryKey: ["locations"] });
}
