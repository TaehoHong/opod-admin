import { Code, Stack, Text } from "@mantine/core";
import { previewUrl } from "../../shared/media/previewUrl";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import classes from "../../shared/ui/LogDetails.module.css";
import type { LlmLogMediaItem } from "./api";

export function LlmLogPayload({
  value,
  stringify = false,
}: {
  value: unknown;
  stringify?: boolean;
}) {
  return (
    <Code block className={classes.payload}>
      {!stringify && typeof value === "string"
        ? value
        : JSON.stringify(value ?? null, null, 2)}
    </Code>
  );
}

export function LlmLogMediaTile({ item }: { item: LlmLogMediaItem }) {
  const source = previewUrl(item.url);
  return (
    <Stack gap={4}>
      {source ? (
        <ZoomableImage
          src={source}
          alt={`${item.role} ${item.sortOrder + 1}`}
          h={120}
          fit="contain"
        />
      ) : (
        <Text size="xs" c="dimmed">
          미리보기 없음
        </Text>
      )}
      <Text size="xs">
        {item.role} #{item.sortOrder + 1}
      </Text>
      <Text size="xs" c="dimmed">
        {item.contentType ?? item.mediaType}
      </Text>
    </Stack>
  );
}
