import {
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
} from "@phosphor-icons/react";
import { previewUrl } from "../../shared/media/previewUrl";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import type { InfluencerMedia } from "./api";
import classes from "./ReferenceLibrary.module.css";

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
export function assetLabel(item: InfluencerMedia) {
  return item.assetType === "video_thumbnail" ? "영상 썸네일" : "사진";
}
export function MediaDetailModal({
  item,
  items,
  onSelect,
  onClose,
  onRefresh,
}: {
  item: InfluencerMedia;
  items: InfluencerMedia[];
  onSelect: (item: InfluencerMedia) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const index = items.findIndex((entry) => entry.id === item.id);
  const image = previewUrl(item.imageUrl);
  const postUrl = previewUrl(item.postUrl);
  return (
    <Modal
      opened
      onClose={onClose}
      title={`@${item.influencer?.username || "계정"} · ${assetLabel(item)}`}
      size="min(1100px, 96vw)"
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Badge variant="light" color="ink">
              {assetLabel(item)}
            </Badge>
            <Text size="sm" c="ink.6">
              슬라이드 {item.slideIndex}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              size="xs"
              disabled={index <= 0}
              onClick={() => onSelect(items[index - 1])}
              aria-label="이전 미디어"
            >
              <CaretLeft size={16} aria-hidden />
            </Button>
            <Text size="sm">
              {index + 1} / {items.length}
            </Text>
            <Button
              variant="default"
              size="xs"
              disabled={index < 0 || index >= items.length - 1}
              onClick={() => onSelect(items[index + 1])}
              aria-label="다음 미디어"
            >
              <CaretRight size={16} aria-hidden />
            </Button>
          </Group>
        </Group>
        <div className={classes.detail}>
          <div className={classes.fullImage}>
            {image ? (
              <ZoomableImage
                key={image}
                src={image}
                alt={
                  item.analysis?.content.description ||
                  `${item.postId} ${item.slideIndex}번 이미지`
                }
                fit="contain"
                className={classes.original}
              />
            ) : (
              <Text p="xl">이미지 주소를 불러오지 못했습니다.</Text>
            )}
            <Button
              variant="subtle"
              color="ink"
              size="xs"
              leftSection={<ArrowClockwise size={14} aria-hidden />}
              onClick={onRefresh}
            >
              이미지가 안 보이면 새로고침
            </Button>
          </div>
          <Stack gap="md" className={classes.wrap}>
            {postUrl ? (
              <Anchor
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
              >
                원본 게시물 열기 <ArrowSquareOut size={14} aria-hidden />
              </Anchor>
            ) : null}
            <Title order={2} size="h4">
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
                <details>
                  <summary>분석 정보</summary>
                  <Text size="xs" c="ink.6">
                    모델: {item.analysis.model || "기록 없음"}
                    <br />
                    버전: {item.analysis.version || "기록 없음"}
                  </Text>
                </details>
              </>
            ) : (
              <Text size="sm" c="ink.6">
                이미지는 저장됐지만 아직 분석 내용이 없습니다. 수집·분석 Work가
                등록하면 여기에 표시됩니다.
              </Text>
            )}
            {item.assetType === "video_thumbnail" ? (
              <Text size="xs" c="ink.6">
                영상 원본은 보관하지 않으며 썸네일 이미지만 표시합니다.
              </Text>
            ) : null}
          </Stack>
        </div>
      </Stack>
    </Modal>
  );
}
