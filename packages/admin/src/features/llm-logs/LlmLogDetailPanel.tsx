import {
  Accordion,
  Alert,
  Code,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { previewUrl } from "../../shared/media/previewUrl";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import { fetchLlmLog, type LlmLogMediaItem } from "./api";

// provider payload는 기본 화면에 펼치지 않고 필요할 때 연다
// (docs/04-design-rules.md:12).
const JSON_SECTIONS = [
  { key: "systemPromptJson", label: "system prompt" },
  { key: "userPromptJson", label: "user prompt" },
  { key: "requestJson", label: "request" },
  { key: "responseJson", label: "response" },
  { key: "metadataJson", label: "metadata" },
] as const;

export function LlmLogDetailPanel({ id }: { id: string }) {
  const log = useQuery({
    queryKey: ["llm-logs", "detail", id],
    queryFn: () => fetchLlmLog(id),
  });

  if (log.isPending) {
    return <Loader aria-label="LLM 로그 상세 불러오는 중" />;
  }
  if (log.error) {
    return (
      <Alert color="red" role="alert" title="불러오지 못했습니다">
        {log.error.message}
      </Alert>
    );
  }

  const detail = log.data;
  const tokens = [detail.inputTokens, detail.outputTokens, detail.totalTokens]
    .map((value) => value?.toLocaleString() ?? "—")
    .join(" / ");

  return (
    <Paper p="md">
      <Stack gap="sm">
        <Group gap="sm" align="baseline">
          <Title order={5}>로그 #{detail.id}</Title>
          <Text size="sm" c="dimmed">
            {detail.type} · {detail.provider} · {detail.model}
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Field label="토큰 (입력/출력/합계)">{tokens}</Field>
          <Field label="소요">
            {detail.durationMs === null
              ? "—"
              : `${detail.durationMs.toLocaleString()} ms`}
          </Field>
          <Field label="HTTP">{detail.httpStatus ?? "—"}</Field>
          <Field label="스트리밍">{detail.isStreaming ? "예" : "아니오"}</Field>
        </SimpleGrid>

        {detail.errorMessage ? (
          <Alert color="red" title={detail.errorType ?? "호출 실패"}>
            {detail.errorMessage}
          </Alert>
        ) : null}

        {detail.redactedPaths.length > 0 ? (
          <Text size="xs" c="dimmed">
            민감정보로 가려진 경로: {detail.redactedPaths.join(", ")}
          </Text>
        ) : null}

        <Accordion variant="contained">
          {JSON_SECTIONS.map((section) => (
            <Accordion.Item key={section.key} value={section.key}>
              <Accordion.Control>{section.label}</Accordion.Control>
              <Accordion.Panel>
                <Code block>
                  {JSON.stringify(detail[section.key] ?? null, null, 2)}
                </Code>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>

        {detail.media.length > 0 ? (
          <Stack gap="xs">
            <Title order={6}>미디어 입출력</Title>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              {detail.media.map((item) => (
                <MediaTile
                  key={`${item.role}-${item.sortOrder}-${item.id}`}
                  item={item}
                />
              ))}
            </SimpleGrid>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

function MediaTile({ item }: { item: LlmLogMediaItem }) {
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
