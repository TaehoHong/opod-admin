import { NaturalAgentPanel } from "./NaturalAgentPanel";
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useBeforeUnload, useNavigate, useParams } from "react-router-dom";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { useCursorList } from "../../shared/api/useCursorList";
import { AgentEditor } from "./AgentEditor";
import { ModelManager } from "./ModelManager";
import { fetchAgents, fetchModels, LABELS, STAGES, type Stage } from "./api";
import classes from "./PostAgentsPage.module.css";
export function PostAgentsPage() {
  const { stage: stageParam } = useParams();
  const stage = STAGES.includes(stageParam as Stage)
    ? (stageParam as Stage)
    : "post_plan";
  const navigate = useNavigate();
  const agents = useQuery({ queryKey: ["post-agents"], queryFn: fetchAgents });
  const models = useCursorList(["post-agent-models"], fetchModels);
  const [modelManager, setModelManager] = useState(false);
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [naturalDirty, setNaturalDirty] = useState(false);
  const dirty = legacyDirty || naturalDirty;
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  useEffect(() => {
    if (!dirty) return;
    const capture = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.origin !== window.location.origin ||
        anchor.href === window.location.href
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPendingPath(anchor.pathname + anchor.search + anchor.hash);
    };
    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, [dirty]);
  const selected = agents.data?.items.find((config) => config.stage === stage);
  return (
    <DataPage
      title="게시물 Agent 관리"
      isPending={agents.isPending}
      error={agents.error}
      actions={
        <Group>
          {agents.error ? (
            <Button variant="default" onClick={() => void agents.refetch()}>
              다시 시도
            </Button>
          ) : null}
          <Button variant="default" onClick={() => setModelManager(true)}>
            모델 관리
          </Button>
        </Group>
      }
    >
      <Stack gap="lg">
        <Text>
          단계별 지침과 실행 모델을 관리합니다. 저장한 버전과 실제 실행 기록을
          연결해 확인할 수 있습니다.
        </Text>
        {models.error ? (
          <Alert
            color="red"
            role="alert"
            title="모델 목록을 불러오지 못했습니다"
          >
            {models.error.message}
            <Button variant="default" onClick={() => void models.refetch()}>
              다시 시도
            </Button>
          </Alert>
        ) : null}
        <NaturalAgentPanel
          models={models.items}
          onDirtyChange={setNaturalDirty}
        />
        <div className={classes.layout}>
          <Paper p="md" className={classes.stageList}>
            <Stack gap="xs" role="navigation" aria-label="게시물 생성 단계">
              {STAGES.map((item, index) => (
                <Button
                  key={item}
                  variant={item === stage ? "light" : "subtle"}
                  justify="space-between"
                  aria-current={item === stage ? "step" : undefined}
                  onClick={() => {
                    const path = `/post-generation-agents/${item}`;
                    if (item !== stage) {
                      if (dirty) setPendingPath(path);
                      else navigate(path);
                    }
                  }}
                >
                  <Group gap="xs" wrap="nowrap">
                    <Badge variant="outline" size="sm">
                      {index + 1}
                    </Badge>
                    {LABELS[item]}
                  </Group>
                </Button>
              ))}
            </Stack>
          </Paper>
          <Paper p="lg" className={classes.editor}>
            {selected ? (
              <AgentEditor
                key={stage}
                config={selected}
                models={models.items}
                onDirtyChange={setLegacyDirty}
              />
            ) : null}
            <LoadMore
              hasNextPage={!!models.hasNextPage}
              isFetching={models.isFetchingNextPage}
              onLoadMore={() => void models.fetchNextPage()}
            />
          </Paper>
        </div>
      </Stack>
      <Modal
        opened={modelManager}
        onClose={() => setModelManager(false)}
        title="모델 관리"
        size="lg"
        closeButtonProps={{ "aria-label": "모델 관리 닫기" }}
      >
        <ModelManager />
      </Modal>
      <Modal
        opened={!!pendingPath}
        onClose={() => setPendingPath(null)}
        title="수정 중인 설정이 있습니다"
        closeButtonProps={{ "aria-label": "편집 계속하기" }}
      >
        <Stack>
          <Text>
            입력은 이 브라우저에 임시 보관됩니다. 설정을 적용하려면 저장해야
            합니다.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingPath(null)}>
              계속 편집
            </Button>
            <Button
              onClick={() => {
                setLegacyDirty(false);
                setNaturalDirty(false);
                navigate(pendingPath!);
                setPendingPath(null);
              }}
            >
              이동
            </Button>
          </Group>
        </Stack>
      </Modal>
    </DataPage>
  );
}
