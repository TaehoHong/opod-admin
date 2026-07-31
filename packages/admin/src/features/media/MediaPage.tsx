import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { previewUrl } from "../../shared/media/previewUrl";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { MediaUploadModal } from "./MediaUploadModal";
import {
  confirmMediaUpload,
  fetchMediaList,
  mediaDimensionsLabel,
  mediaFileName,
  mediaSizeLabel,
  type MediaItem,
} from "./api";

const TYPE_FILTER = [
  { value: "", label: "전체" },
  { value: "image", label: "image" },
  { value: "video", label: "video" },
];

const UPLOAD_FILTER = [
  { value: "", label: "전체" },
  { value: "true", label: "확정" },
  { value: "false", label: "pending" },
];

export function MediaPage() {
  const [mediaType, setMediaType] = useState("");
  const [uploaded, setUploaded] = useState("");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const queryClient = useQueryClient();

  const media = useCursorList(["media", mediaType, uploaded], (cursor) =>
    fetchMediaList({
      ...(mediaType ? { mediaType } : {}),
      ...(uploaded ? { uploaded } : {}),
      cursor,
    }),
  );

  const confirm = useMutation({
    mutationFn: (mediaId: string) => confirmMediaUpload(mediaId),
    onSuccess: (updated) => {
      setSelected((current) =>
        current?.id === updated.id ? updated : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });

  return (
    <DataPage
      title="미디어"
      isPending={media.isPending}
      error={media.error}
      isEmpty={media.items.length === 0}
      emptyLabel="조건에 맞는 미디어가 없습니다."
      actions={
        <Group gap="xs">
          <SegmentedControl
            aria-label="미디어 타입"
            data={TYPE_FILTER}
            value={mediaType}
            onChange={setMediaType}
          />
          <SegmentedControl
            aria-label="업로드 상태"
            data={UPLOAD_FILTER}
            value={uploaded}
            onChange={setUploaded}
          />
          <Button onClick={() => setUploadOpen(true)}>업로드 시작</Button>
        </Group>
      }
    >
      {confirm.isError ? (
        <Alert color="red" role="alert" title="확정하지 못했습니다">
          {confirm.error.message}
        </Alert>
      ) : null}

      <Table.ScrollContainer minWidth={920}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>파일</Table.Th>
              <Table.Th>타입</Table.Th>
              <Table.Th>크기</Table.Th>
              <Table.Th>해상도</Table.Th>
              <Table.Th>업로드 상태</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {media.items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td maw={280}>
                  <Text lineClamp={1}>{mediaFileName(item)}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{item.mediaType}</Badge>
                </Table.Td>
                <Table.Td>{mediaSizeLabel(item)}</Table.Td>
                <Table.Td>{mediaDimensionsLabel(item)}</Table.Td>
                <Table.Td>
                  {item.uploadedAt ? (
                    <Badge color="teal">
                      확정 {item.uploadedAt.slice(0, 10)}
                    </Badge>
                  ) : (
                    <Badge color="attention">업로드 대기</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {item.uploadedAt ? null : (
                      <Button
                        size="compact-sm"
                        loading={
                          confirm.isPending && confirm.variables === item.id
                        }
                        onClick={() => confirm.mutate(item.id)}
                      >
                        업로드 확정
                      </Button>
                    )}
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() =>
                        setSelected((current) =>
                          current?.id === item.id ? null : item,
                        )
                      }
                    >
                      {selected?.id === item.id ? "닫기" : "상세"}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <LoadMore
        hasNextPage={media.hasNextPage}
        isFetching={media.isFetchingNextPage}
        onLoadMore={() => void media.fetchNextPage()}
      />

      {selected ? <MediaDetail item={selected} /> : null}

      <MediaUploadModal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
      />
    </DataPage>
  );
}

function MediaDetail({ item }: { item: MediaItem }) {
  const source = item.mediaType === "image" ? previewUrl(item.url) : null;
  return (
    <Paper p="md" maw={640}>
      <Stack gap="sm">
        <Title order={5}>{mediaFileName(item)}</Title>
        {source ? (
          <Image src={source} alt={mediaFileName(item)} h={220} fit="contain" />
        ) : null}
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
          <Field label="Content-Type">{item.contentType ?? "—"}</Field>
          <Field label="크기">{mediaSizeLabel(item)}</Field>
          <Field label="해상도">{mediaDimensionsLabel(item)}</Field>
          <Field label="생성">{item.createdAt.slice(0, 10)}</Field>
          <Field label="업로드 확정">
            {item.uploadedAt?.replace("T", " ").slice(0, 16) ?? "대기"}
          </Field>
          <Field label="미디어 ID">
            <Text size="xs" c="dimmed">
              {item.id}
            </Text>
          </Field>
        </SimpleGrid>
        <Field label="URL">
          <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
            {item.url}
          </Text>
        </Field>
      </Stack>
    </Paper>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Stack>
  );
}
