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
  Tabs,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  useBeforeUnload,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
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
  const [search] = useSearchParams();
  const natural = search.get("agent") === "natural";
  const agents = useQuery({ queryKey: ["post-agents"], queryFn: fetchAgents });
  const models = useCursorList(["post-agent-models"], fetchModels);
  const [modelManager, setModelManager] = useState(false);
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [naturalDirty, setNaturalDirty] = useState(false);
  const [generationDirty, setGenerationDirty] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const dirty = legacyDirty || naturalDirty || generationDirty;
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
  const generation = agents.data?.items.find(
    (config) => config.stage === "generation",
  );
  const go = (path: string) => {
    if (dirty) setPendingPath(path);
    else navigate(path);
  };
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
        <Tabs
          keepMounted={false}
          value={natural ? "natural" : "existing"}
          onChange={(value) => {
            if ((value === "natural") !== natural)
              go(
                `/post-generation-agents/${stage}${value === "natural" ? "?agent=natural" : ""}`,
              );
          }}
        >
          <Tabs.List aria-label="Agent 설정 선택">
            <Tabs.Tab value="existing">기존 Agent</Tabs.Tab>
            <Tabs.Tab value="natural">새 Agent · 자연스러운 사진</Tabs.Tab>
          </Tabs.List>
          {models.error && !natural ? (
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
          <Tabs.Panel value="natural" pt="lg">
            <NaturalAgentPanel
              models={models.items}
              modelsPending={models.isPending}
              modelsError={models.error}
              onRetryModels={() => void models.refetch()}
              onManageModels={() => setModelManager(true)}
              generation={generation}
              onConfigureGeneration={() => setGenerationOpen(true)}
              onDirtyChange={setNaturalDirty}
            />
          </Tabs.Panel>
          <Tabs.Panel value="existing" pt="lg">
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
          </Tabs.Panel>
        </Tabs>
        {natural ? (
          <LoadMore
            hasNextPage={!!models.hasNextPage}
            isFetching={models.isFetchingNextPage}
            onLoadMore={() => void models.fetchNextPage()}
          />
        ) : null}
      </Stack>
      <Modal
        opened={generationOpen}
        onClose={() =>
          generationDirty
            ? setPendingPath("#close-generation")
            : setGenerationOpen(false)
        }
        title="공통 이미지 생성 모델 설정"
        size="xl"
        closeButtonProps={{ "aria-label": "이미지 생성 설정 닫기" }}
      >
        <Stack>
          <Alert color="attention">
            기존·새 Agent가 함께 사용하는 이미지 생성 모델입니다. 저장하면 이후
            만드는 프롬프트에 적용됩니다.
          </Alert>
          <Button variant="default" onClick={() => setModelManager(true)}>
            모델 등록·관리
          </Button>
          {generation ? (
            <AgentEditor
              config={generation}
              models={models.items}
              onDirtyChange={setGenerationDirty}
              onSaved={() => void agents.refetch()}
            />
          ) : null}
        </Stack>
      </Modal>
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
                if (pendingPath === "#close-generation") {
                  setGenerationDirty(false);
                  setGenerationOpen(false);
                } else {
                  setLegacyDirty(false);
                  setNaturalDirty(false);
                  navigate(pendingPath!);
                }
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
