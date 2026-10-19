import {
  Anchor,
  AspectRatio,
  Badge,
  Button,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { previewUrl } from "../../shared/media/previewUrl";
import { LoadMore } from "../../shared/ui/DataPage";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import { fetchInfluencerMedia, type InfluencerMedia } from "./api";
import classes from "./InfluencerMediaModal.module.css";

const analysisFields = [
  ["personCount", "인원"],
  ["framing", "구도"],
  ["pose", "포즈"],
  ["hands", "손의 위치"],
  ["gaze", "시선"],
  ["camera", "촬영 각도"],
  ["placement", "인물 배치"],
  ["background", "배경"],
  ["wardrobe", "의상"],
  ["lighting", "조명"],
] as const;

// Render only while an account is open. The caller keys by account to reset selection.
export function InfluencerMediaModal({
  account,
  onClose,
}: {
  account: { id: string; url: string };
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const media = useCursorList(["influencer-media", account.id], (cursor) =>
    fetchInfluencerMedia(account.id, cursor),
  );
  const selected = media.items.find((item) => item.id === selectedId);
  const accountUrl = previewUrl(account.url);
  return (
    <Modal opened onClose={onClose} title="계정별 수집 미디어" size="xl">
      <Stack gap="md">
        <Group justify="space-between" align="start">
          {accountUrl ? (
            <Anchor
              href={accountUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={classes.wrap}
            >
              {account.url}
            </Anchor>
          ) : (
            <Text>{account.url}</Text>
          )}
          <Button
            variant="default"
            size="xs"
            loading={media.isFetching}
            onClick={() => void media.refetch()}
          >
            새로고침
          </Button>
        </Group>
        {media.error ? (
          <OperationErrorAlert
            failure={operationFailure(
              media.error,
              "수집 미디어를 불러오지 못했습니다. 새로고침해 주세요.",
            )}
          />
        ) : null}
        {media.isPending ? (
          <Loader size="sm" aria-label="수집 미디어 불러오는 중" />
        ) : null}
        {!media.isPending && !media.error && media.items.length === 0 ? (
          <Paper p="lg" withBorder>
            <Text c="dimmed" role="status">
              이 계정에서 수집한 미디어가 아직 없습니다. 수집 Work가 등록하면
              여기에 표시됩니다.
            </Text>
          </Paper>
        ) : null}
        {selected ? (
          <>
            <Button variant="subtle" onClick={() => setSelectedId(null)}>
              미디어 목록으로
            </Button>
            <MediaDetail item={selected} />
          </>
        ) : (
          <>
            {media.items.length ? (
              <Text size="sm" c="dimmed">
                {media.items.length}개 표시 · 이미지를 선택하면 분석 내용을 볼
                수 있습니다.
              </Text>
            ) : null}
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
              {media.items.map((item) => (
                <Paper
                  key={item.id}
                  withBorder
                  radius="md"
                  className={classes.card}
                >
                  <UnstyledButton
                    w="100%"
                    onClick={() => setSelectedId(item.id)}
                    aria-label={`${item.postId} ${item.slideIndex}번 ${assetLabel(item)} 분석 보기`}
                  >
                    <MediaPreview key={item.imageUrl} item={item} />
                    <Stack p="sm" gap="xs">
                      <Group gap="xs">
                        <Badge variant="light" color="ink">
                          {assetLabel(item)}
                        </Badge>
                        <Badge
                          variant="light"
                          color={item.analysis ? "teal" : "gray"}
                        >
                          {item.analysis ? "분석 있음" : "미분석"}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {item.postId} · {item.slideIndex}번
                      </Text>
                      <Text size="sm" lineClamp={2}>
                        {item.analysis?.content.description ||
                          "등록된 분석 내용이 없습니다."}
                      </Text>
                    </Stack>
                  </UnstyledButton>
                </Paper>
              ))}
            </SimpleGrid>
            <LoadMore
              hasNextPage={Boolean(media.hasNextPage)}
              isFetching={media.isFetching}
              onLoadMore={() => void media.fetchNextPage()}
            />
          </>
        )}
        {media.items.length ? (
          <Text size="xs" c="dimmed">
            이미지가 열리지 않으면 새로고침해 주세요. 영상은 썸네일만
            보관합니다.
          </Text>
        ) : null}
      </Stack>
    </Modal>
  );
}

function assetLabel(item: InfluencerMedia) {
  return item.assetType === "video_thumbnail" ? "영상 썸네일" : "사진";
}

function MediaPreview({
  item,
  zoom = false,
}: {
  item: InfluencerMedia;
  zoom?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = previewUrl(item.imageUrl);
  const alt =
    item.analysis?.content.description ||
    `${item.postId} ${item.slideIndex}번 ${assetLabel(item)}`;
  return (
    <AspectRatio ratio={4 / 5}>
      {!src || failed ? (
        <Text size="sm" ta="center" c="dimmed">
          이미지를 불러오지 못했습니다.
        </Text>
      ) : zoom ? (
        <ZoomableImage
          src={src}
          alt={alt}
          fit="contain"
          h="100%"
          onError={() => setFailed(true)}
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          fit="contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </AspectRatio>
  );
}

function MediaDetail({ item }: { item: InfluencerMedia }) {
  const postUrl = previewUrl(item.postUrl);
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
      <MediaPreview key={item.imageUrl} item={item} zoom />
      <Stack gap="md" className={classes.wrap}>
        <Group gap="xs">
          <Badge color="ink" variant="light">
            {assetLabel(item)}
          </Badge>
          <Text size="sm">{item.slideIndex}번 미디어</Text>
        </Group>
        {postUrl ? (
          <Anchor href={postUrl} target="_blank" rel="noopener noreferrer">
            원본 게시물 열기
          </Anchor>
        ) : null}
        <Title order={3} size="h5">
          이미지 분석
        </Title>
        {item.analysis ? (
          <>
            <Text size="sm" className={classes.description}>
              {item.analysis.content.description}
            </Text>
            <dl className={classes.analysis}>
              {analysisFields.map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd>{item.analysis!.content[field] ?? "기록 없음"}</dd>
                </div>
              ))}
            </dl>
            <Text size="xs" c="dimmed">
              분석 모델: {item.analysis.model || "기록 없음"} · 분석 버전:{" "}
              {item.analysis.version || "기록 없음"}
            </Text>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            이미지는 저장됐지만 분석 내용은 아직 등록되지 않았습니다.
          </Text>
        )}
      </Stack>
    </SimpleGrid>
  );
}
