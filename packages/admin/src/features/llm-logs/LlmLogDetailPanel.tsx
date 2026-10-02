import {
  Accordion,
  Alert,
  Code,
  Group,
  Badge,
  Button,
  Anchor,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { DataPage } from "../../shared/ui/DataPage";
import { CharacterName, UserName } from "../../shared/ui/EntityName";
import { LogField as Field, logDateTime } from "../../shared/ui/LogField";
import classes from "../../shared/ui/LogDetails.module.css";
import { useQuery } from "@tanstack/react-query";
import { previewUrl } from "../../shared/media/previewUrl";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import { fetchLlmLog, type LlmLogMediaItem } from "./api";

// provider payload는 기본 화면에 펼치지 않고 필요할 때 연다
// (docs/04-design-rules.md:12).
const JSON_SECTIONS = [
  { key: "requestJson", label: "요청 원본" },
  { key: "usageJson", label: "사용량 원본" },
  { key: "metadataJson", label: "메타데이터" },
] as const;

export function LlmLogDetailPanel({ id }: { id: string }) {
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const log = useQuery({
    queryKey: ["llm-logs", "detail", id],
    queryFn: () => fetchLlmLog(id),
  });

  useEffect(() => {
    heading.current?.focus();
  }, [log.data]);

  const detail = log.data;
  return (
    <DataPage
      title="LLM 로그 상세"
      isPending={log.isPending}
      error={log.error}
      actions={
        <Group gap="xs">
          {log.error ? (
            <Button
              variant="default"
              onClick={() => void log.refetch()}
              loading={log.isFetching}
            >
              다시 시도
            </Button>
          ) : null}
          <Button
            component={Link}
            to={`/llm-logs${location.search}`}
            variant="default"
          >
            목록으로
          </Button>
        </Group>
      }
    >
      {detail ? <LogContent detail={detail} heading={heading} /> : null}
    </DataPage>
  );
}

function LogContent({
  detail,
  heading,
}: {
  detail: Awaited<ReturnType<typeof fetchLlmLog>>;
  heading: React.RefObject<HTMLHeadingElement | null>;
}) {
  const tokens = [detail.inputTokens, detail.outputTokens, detail.totalTokens]
    .map((value) => value?.toLocaleString() ?? "—")
    .join(" / ");
  const generationMs =
    detail.durationMs === null
      ? null
      : Math.max(0, detail.durationMs - (detail.timeToFirstTokenMs ?? 0));
  const tokensPerSecond =
    detail.outputTokens && generationMs
      ? (detail.outputTokens * 1000) / generationMs
      : null;

  return (
    <Paper p="md">
      <Stack gap="sm">
        <Group gap="sm" align="baseline">
          <Badge
            color={
              detail.status === "failed"
                ? "red"
                : detail.status === "running"
                  ? "attention"
                  : "teal"
            }
          >
            {detail.status === "failed"
              ? "실패"
              : detail.status === "running"
                ? "진행 중"
                : "성공"}
          </Badge>
          <Title order={2} ref={heading} tabIndex={-1}>
            {detail.type}
          </Title>
          <Text size="sm" c="dimmed">
            {detail.provider} · {detail.displayModel}
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Field label="시작 시각 (KST)">{logDateTime(detail.createdAt)}</Field>
          <Field label="완료 시각 (KST)">
            {logDateTime(detail.completedAt)}
          </Field>
        </SimpleGrid>
        {detail.errorMessage ? (
          <Alert
            color="red"
            title={detail.errorType ?? "호출 실패"}
            className={classes.text}
          >
            {detail.errorMessage}
          </Alert>
        ) : null}
        <Title order={2}>프롬프트 · 응답</Title>
        <Accordion
          variant="contained"
          multiple
          defaultValue={["userPromptJson"]}
        >
          {(
            [
              { key: "systemPromptJson", label: "시스템 프롬프트" },
              { key: "userPromptJson", label: "사용자 프롬프트" },
              { key: "responseJson", label: "응답 원본" },
            ] as const
          ).map(({ key, label }) => (
            <Accordion.Item key={key} value={key}>
              <Accordion.Control>{label}</Accordion.Control>
              <Accordion.Panel>
                <Code block className={classes.payload}>
                  {typeof detail[key] === "string"
                    ? (detail[key] as string)
                    : JSON.stringify(detail[key] ?? null, null, 2)}
                </Code>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
        {detail.media.length > 0 ? (
          <Stack gap="xs">
            <Title order={3}>미디어 입출력</Title>
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
        <Title order={2}>사용량 · 성능 · 비용</Title>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Field label="요청 모델">{detail.model}</Field>
          <Field label="응답 모델">{detail.responseModel ?? "—"}</Field>
          <Field label="토큰 (입력/출력/합계)">{tokens}</Field>
          <Field label="캐시 (읽기/쓰기)">
            {detail.cachedInputTokens?.toLocaleString() ?? "—"} /{" "}
            {detail.cacheWriteTokens?.toLocaleString() ?? "—"}
          </Field>
          <Field label="추론 토큰">
            {detail.reasoningTokens?.toLocaleString() ?? "—"}
          </Field>
          <Field label="소요">
            {detail.durationMs === null
              ? "—"
              : `${detail.durationMs.toLocaleString()} ms`}
          </Field>
          <Field label="첫 토큰 (TTFT)">
            {detail.timeToFirstTokenMs === null
              ? "—"
              : `${detail.timeToFirstTokenMs.toLocaleString()} ms`}
          </Field>
          <Field
            label={
              detail.timeToFirstTokenMs === null ? "평균 처리량" : "생성 속도"
            }
          >
            {tokensPerSecond === null
              ? "—"
              : `${tokensPerSecond.toFixed(1)} tok/s`}
          </Field>
          <Field label="비용">{formatCost(detail.cost)}</Field>
          <Field label="upstream 비용">{formatCost(detail.upstreamCost)}</Field>
          <Field label="종료 사유">{detail.finishReason ?? "—"}</Field>
          <Field label="HTTP">{detail.httpStatus ?? "—"}</Field>
          <Field label="스트리밍">{detail.isStreaming ? "예" : "아니오"}</Field>
        </SimpleGrid>

        {detail.redactedPaths.length > 0 ? (
          <Text size="xs" c="dimmed">
            민감정보로 가려진 경로: {detail.redactedPaths.join(", ")}
          </Text>
        ) : null}

        <Title order={2}>연결 정보 · 원본 데이터</Title>
        <Accordion variant="contained">
          <Accordion.Item value="context">
            <Accordion.Control>연결 · 식별 정보</Accordion.Control>
            <Accordion.Panel>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Field label="로그 ID">{detail.id}</Field>
                <Field label="요청 ID">{detail.requestId ?? "—"}</Field>
                <Field label="공급자 요청 ID">
                  {detail.providerRequestId ?? "—"}
                </Field>
                <Field label="엔드포인트">{detail.endpoint ?? "—"}</Field>
                <Field label="캐릭터">
                  {detail.characterId ? (
                    <Anchor
                      component={Link}
                      to={`/characters/${encodeURIComponent(detail.characterId)}`}
                    >
                      <CharacterName id={detail.characterId} />
                    </Anchor>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="캐릭터 ID">{detail.characterId ?? "—"}</Field>
                <Field label="사용자">
                  {detail.userId ? (
                    <Anchor
                      component={Link}
                      to={`/users/${encodeURIComponent(detail.userId)}`}
                    >
                      <UserName id={detail.userId} />
                    </Anchor>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="사용자 ID">{detail.userId ?? "—"}</Field>
                <Field label="생성 작업">
                  {detail.generationJobId ? (
                    <Anchor
                      component={Link}
                      to={`/generation/${encodeURIComponent(detail.generationJobId)}`}
                    >
                      {detail.generationJobId}
                    </Anchor>
                  ) : (
                    "—"
                  )}
                </Field>
              </SimpleGrid>
            </Accordion.Panel>
          </Accordion.Item>
          {JSON_SECTIONS.map((section) => (
            <Accordion.Item key={section.key} value={section.key}>
              <Accordion.Control>{section.label}</Accordion.Control>
              <Accordion.Panel>
                <Code block className={classes.payload}>
                  {JSON.stringify(detail[section.key] ?? null, null, 2)}
                </Code>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
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

function formatCost(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 10 });
}
