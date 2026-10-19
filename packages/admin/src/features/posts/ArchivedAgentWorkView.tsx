import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import type { Draft } from "../drafts/api";
import { DRAFT_STATUS_LABEL, SHOT_STATUS_LABEL } from "../drafts/labels";
import { StageExecutionRecords } from "../llm-logs/StageExecutionRecords";
import type { PostWorkItem } from "./api";
import styles from "./PostWorkPage.module.css";

const ARTIFACTS = [
  { key: "postPlanning", label: "게시글 기획", type: "admin.v3.post.plan" },
  { key: "imagePlanning", label: "이미지 기획", type: "admin.v3.image.plan" },
  { key: "promptBuild", label: "프롬프트", type: "admin.v3.image.prompt" },
  { key: "captionBuild", label: "캡션", type: "admin.v4.caption.write" },
  { key: "plan", label: "이전 기획", type: "admin.content.plan" },
] as const;

export function ArchivedAgentWorkView({
  item,
  draft,
}: {
  item: PostWorkItem;
  draft: Draft;
}) {
  const concept: Record<string, unknown> = draft.conceptJson ?? {};
  return (
    <DataPage
      title="기존 Agent 작업 기록"
      isPending={false}
      actions={
        <Button component={Link} to="/posts" variant="default">
          목록으로
        </Button>
      }
    >
      <Stack gap="lg">
        <Alert title="보관된 작업 · 읽기 전용">
          기존 Agent의 실행이 종료되었습니다. 저장된 입력과 생성 결과, 실행
          기록을 확인할 수 있습니다.
        </Alert>
        <Group gap="sm">
          <CharacterName id={item.characterId} />
          <Badge variant="light">{item.contentType}</Badge>
          <Text size="sm" c="dimmed">
            보관 당시 상태 · {DRAFT_STATUS_LABEL[draft.status]}
          </Text>
        </Group>
        {draft.errorMessage ? (
          <Alert color="red" title="저장된 오류">
            {draft.errorMessage}
          </Alert>
        ) : null}
        <Paper p="lg">
          <Stack gap="sm">
            <Title order={3}>저장된 캡션</Title>
            <Text className={styles.publishCaption}>
              {draft.caption || "저장된 캡션이 없습니다."}
            </Text>
            {draft.hashtags.length ? (
              <Text size="sm" c="dimmed">
                {draft.hashtags.map((tag) => `#${tag}`).join(" ")}
              </Text>
            ) : null}
          </Stack>
        </Paper>
        <Stack gap="sm">
          <Title order={3}>생성 결과</Title>
          {draft.shots?.length ? (
            draft.shots.map((shot) => (
              <Paper key={shot.jobId} p="md">
                <Stack gap="sm">
                  <Text fw={600}>
                    컷 {shot.sortOrder + 1} ·{" "}
                    {SHOT_STATUS_LABEL[shot.status] ?? shot.status}
                  </Text>
                  {shot.outputs.length ? (
                    <div className={styles.mediaGrid}>
                      {shot.outputs.map((output) => (
                        <ZoomableImage
                          key={output.mediaId}
                          src={output.url}
                          alt={`컷 ${shot.sortOrder + 1} 생성 이미지`}
                          className={styles.media}
                        />
                      ))}
                    </div>
                  ) : (
                    <Text size="sm" c="dimmed">
                      저장된 이미지가 없습니다.
                    </Text>
                  )}
                  <Accordion variant="separated">
                    <Accordion.Item value="prompt">
                      <Accordion.Control>저장된 프롬프트</Accordion.Control>
                      <Accordion.Panel>
                        <Code block>
                          {shot.prompt || "저장된 프롬프트가 없습니다."}
                        </Code>
                      </Accordion.Panel>
                    </Accordion.Item>
                    <Accordion.Item value="logs">
                      <Accordion.Control>이미지 실행 기록</Accordion.Control>
                      <Accordion.Panel>
                        <StageExecutionRecords generationJobId={shot.jobId} />
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                </Stack>
              </Paper>
            ))
          ) : (
            <Text c="dimmed">저장된 생성 결과가 없습니다.</Text>
          )}
        </Stack>
        <Accordion variant="separated" multiple>
          {ARTIFACTS.map(({ key, label, type }) => {
            const artifact = concept[key];
            const producerLogId =
              artifact &&
              typeof artifact === "object" &&
              "producerLogId" in artifact &&
              typeof artifact.producerLogId === "string"
                ? artifact.producerLogId
                : undefined;
            return (
              <Accordion.Item value={key} key={key}>
                <Accordion.Control>{label} 산출물·실행 기록</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    {artifact ? (
                      <Code block>{JSON.stringify(artifact, null, 2)}</Code>
                    ) : (
                      <Text size="sm" c="dimmed">
                        저장된 산출물이 없습니다.
                      </Text>
                    )}
                    <StageExecutionRecords
                      producerLogId={producerLogId}
                      requestId={draft.id}
                      type={type}
                    />
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
          <Accordion.Item value="source">
            <Accordion.Control>저장된 입력·산출물 전체</Accordion.Control>
            <Accordion.Panel>
              <Code block>{JSON.stringify(concept, null, 2)}</Code>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </DataPage>
  );
}
