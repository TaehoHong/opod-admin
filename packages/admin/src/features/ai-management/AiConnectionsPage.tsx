import {
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import { ChatCircle, ImageSquare, Plus } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { ChangeHistory } from "./ChangeHistory";
import { ConnectionModal } from "./ConnectionModal";
import { PROVIDERS, useAiConfig } from "./api";
import classes from "./AiManagement.module.css";

export function AiConnectionsPage() {
  const query = useAiConfig();
  const [params, setParams] = useSearchParams();
  const kind = params.get("type") === "image" ? "image" : "llm";
  const selected = params.get("connection");
  const connections =
    query.data?.connections.filter((c) => c.type === kind) ?? [];
  const open = (id: string | null) =>
    setParams({ type: kind, ...(id ? { connection: id } : {}) });
  return (
    <DataPage
      title="API · 모델 관리"
      isPending={query.isPending}
      error={query.error}
      actions={
        <Button
          leftSection={<Plus size={16} aria-hidden />}
          onClick={() => open("new")}
          disabled={!query.data}
        >
          API 연결 추가
        </Button>
      }
    >
      {query.data ? (
        <>
          <Text c="dimmed">API 접속 정보와 모델 목록을 관리합니다.</Text>
          <div className={classes.catalog}>
            <nav
              className={`${classes.navigation} ${classes.types}`}
              aria-label="API 유형"
            >
              {(["llm", "image"] as const).map((type) => {
                const Icon = type === "llm" ? ChatCircle : ImageSquare;
                return (
                  <UnstyledButton
                    key={type}
                    className={classes.navItem}
                    aria-pressed={kind === type}
                    onClick={() => setParams({ type })}
                  >
                    <Icon size={20} aria-hidden />
                    <div>
                      <Text fw={700}>{type === "llm" ? "LLM" : "이미지"}</Text>
                      <Text size="xs" c="dimmed">
                        API{" "}
                        {
                          query.data.connections.filter((c) => c.type === type)
                            .length
                        }
                        개
                      </Text>
                    </div>
                  </UnstyledButton>
                );
              })}
            </nav>
            <Stack gap="lg">
              <Paper
                withBorder
                className={classes.surface}
                component="section"
                aria-label="API 연결 목록"
              >
                <Group justify="space-between" className={classes.panelHeader}>
                  <Title order={2} size="h4">
                    {kind === "llm" ? "LLM" : "이미지"} API
                  </Title>
                  <Text size="sm" c="dimmed">
                    {connections.length}개 연결
                  </Text>
                </Group>
                <Table.ScrollContainer minWidth={660}>
                  <Table verticalSpacing="md" horizontalSpacing="lg">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>API 주소</Table.Th>
                        <Table.Th>공급자 · 방식</Table.Th>
                        <Table.Th>모델</Table.Th>
                        <Table.Th>설정 상태</Table.Th>
                        <Table.Th>
                          <VisuallyHidden>설정</VisuallyHidden>
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {connections.map((c) => (
                        <Table.Tr key={c.id}>
                          <Table.Td>
                            <UnstyledButton
                              className={`${classes.url} ${classes.code}`}
                              onClick={() => open(c.id)}
                            >
                              {c.apiUrl || "API 주소 미설정"}
                            </UnstyledButton>
                          </Table.Td>
                          <Table.Td>{PROVIDERS[c.provider]}</Table.Td>
                          <Table.Td>{c.models.length}개</Table.Td>
                          <Table.Td>
                            <Badge
                              color={c.configured ? "teal" : "orange"}
                              variant="light"
                            >
                              {c.configured ? "설정됨" : "설정 필요"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Button
                              variant="default"
                              size="xs"
                              onClick={() => open(c.id)}
                              aria-label={`${c.apiUrl || PROVIDERS[c.provider]} 설정`}
                            >
                              설정
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {!connections.length ? (
                        <Table.Tr>
                          <Table.Td colSpan={5}>
                            <Text c="dimmed" ta="center" py="xl">
                              등록된 API가 없습니다. API 연결을 추가하세요.
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
              <ChangeHistory changes={query.data.changes} />
            </Stack>
          </div>
          {selected ? (
            <ConnectionModal
              key={selected}
              config={query.data}
              connectionId={selected === "new" ? null : selected}
              kind={kind}
              onClose={() => open(null)}
              onCreated={open}
            />
          ) : null}
        </>
      ) : null}
    </DataPage>
  );
}
