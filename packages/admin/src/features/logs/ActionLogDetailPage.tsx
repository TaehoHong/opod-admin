import {
  Accordion,
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { LogField, logDateTime } from "../../shared/ui/LogField";
import classes from "../../shared/ui/LogDetails.module.css";
import { fetchCharacterActionLog } from "./api";
import { actionColor } from "./actionColor";

export function ActionLogDetailPage({ id }: { id: string }) {
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const log = useQuery({
    queryKey: ["character-action-logs", "detail", id],
    queryFn: () => fetchCharacterActionLog(id),
  });
  useEffect(() => {
    heading.current?.focus();
  }, [log.data]);
  const detail = log.data;
  return (
    <DataPage
      title="액션 로그 상세"
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
            to={`/logs${location.search}`}
            variant="default"
          >
            목록으로
          </Button>
        </Group>
      }
    >
      {detail ? (
        <Stack gap="lg">
          <Paper p="lg">
            <Stack gap="md">
              <Title order={2} ref={heading} tabIndex={-1}>
                액션 기록
              </Title>
              <Badge variant="light" color={actionColor(detail.actionType)}>
                {detail.actionType}
              </Badge>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <LogField label="캐릭터">
                  <Anchor
                    component={Link}
                    to={`/characters/${encodeURIComponent(detail.characterId)}`}
                  >
                    <CharacterName id={detail.characterId} />
                  </Anchor>
                </LogField>
                <LogField label="발생 시각 (KST)">
                  {logDateTime(detail.createdAt)}
                </LogField>
              </SimpleGrid>
            </Stack>
          </Paper>
          <Paper p="lg">
            <Stack gap="md">
              <Title order={2}>사유</Title>
              <Text className={classes.text}>
                {detail.reason || "기록된 사유가 없습니다."}
              </Text>
            </Stack>
          </Paper>
          <Accordion variant="contained">
            <Accordion.Item value="identifiers">
              <Accordion.Control>대상 · 식별 정보</Accordion.Control>
              <Accordion.Panel>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <LogField label="대상 테이블">
                    {detail.targetTable ?? "—"}
                  </LogField>
                  <LogField label="대상 ID">{detail.targetId ?? "—"}</LogField>
                  <LogField label="캐릭터 ID">{detail.characterId}</LogField>
                  <LogField label="로그 ID">{detail.id}</LogField>
                </SimpleGrid>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      ) : null}
    </DataPage>
  );
}
