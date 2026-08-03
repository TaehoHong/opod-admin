import {
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterName } from "../../shared/ui/EntityName";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import { TableText } from "../../shared/ui/TableText";
import { GenerationJobCompleteModal } from "./GenerationJobCompleteModal";
import { GenerationJobCreateModal } from "./GenerationJobCreateModal";
import { ImageWizard } from "./ImageWizard";
import { NewImageRequestForm } from "./NewImageRequestForm";
import {
  fetchGenerationJobs,
  fetchResolvedProviders,
  retryJob,
  runWorker,
  wizardStep,
  type GenerationJob,
  type JobStatus,
} from "./api";

const STATUS_FILTER = [
  { value: "", label: "전체" },
  { value: "draft", label: "draft" },
  { value: "queued", label: "queued" },
  { value: "running", label: "running" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  draft: "작성 중",
  queued: "대기",
  running: "실행 중",
  completed: "완료",
  failed: "실패",
};

const STATUS_COLOR: Record<JobStatus, string> = {
  draft: "ink",
  queued: "attention",
  running: "accent",
  completed: "teal",
  failed: "red",
};

// 이미지 잡은 위저드 단계를 그대로 상태로 읽는 편이 운영에 유용하다.
const WIZARD_LABEL: Record<string, string> = {
  prompt: "프롬프트 확인",
  generating: "생성 중",
  select: "후보 선택",
  complete: "확정 완료",
  failed: "실패",
};

// 목록 · 새 요청 · 잡 하나를 URL이 구분한다. legacy와 같이 /generation/new는
// 새 요청 화면이고 나머지 세그먼트는 잡 ID다.
const NEW_JOB_SEGMENT = "new";

export function GenerationPage() {
  const [status, setStatus] = useState("");
  const { jobId } = useParams();
  const navigate = useNavigate();
  const openJob = (id: string) => {
    void navigate(`/generation/${encodeURIComponent(id)}`);
  };
  const openList = () => {
    void navigate("/generation");
  };
  const [createOpened, setCreateOpened] = useState(false);
  const [completingJob, setCompletingJob] = useState<GenerationJob | null>(
    null,
  );

  const jobs = useCursorList(["generation", "list", status], (cursor) =>
    fetchGenerationJobs({ ...(status ? { status } : {}), cursor }),
  );
  const providers = useQuery({
    queryKey: ["generation", "providers"],
    queryFn: fetchResolvedProviders,
  });

  if (jobId === NEW_JOB_SEGMENT) {
    return (
      <DataPage title="새 이미지 생성" isPending={false}>
        <NewImageRequestForm onCreated={openJob} onCancel={openList} />
      </DataPage>
    );
  }

  if (jobId) {
    return (
      <DataPage
        title="이미지 생성"
        isPending={false}
        actions={
          <Button variant="default" onClick={openList}>
            목록으로
          </Button>
        }
      >
        <ImageWizard jobId={jobId} onJobChange={openJob} />
      </DataPage>
    );
  }

  return (
    <>
      <DataPage
        title="생성 작업"
        isPending={jobs.isPending}
        error={jobs.error}
        isEmpty={jobs.items.length === 0}
        emptyLabel="조건에 맞는 작업이 없습니다."
        actions={
          <Group gap="xs">
            <SegmentedControl
              aria-label="작업 상태"
              data={STATUS_FILTER}
              value={status}
              onChange={setStatus}
            />
            <Button variant="default" onClick={() => setCreateOpened(true)}>
              생성 작업 큐 등록
            </Button>
            <Button onClick={() => void navigate("/generation/new")}>
              새 이미지 생성
            </Button>
          </Group>
        }
      >
        {providers.data ? (
          <Paper p="sm">
            <Group gap="lg" wrap="wrap">
              <Text size="xs" c="dimmed" tt="uppercase">
                적용 중
              </Text>
              <Text size="sm">t2i · {providers.data.t2iProvider ?? "—"}</Text>
              <Text size="sm">edit · {providers.data.editProvider ?? "—"}</Text>
              <Text size="sm">기획 · {providers.data.plannerProvider}</Text>
            </Group>
          </Paper>
        ) : null}

        <Table.ScrollContainer minWidth={960}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>캐릭터</Table.Th>
                <Table.Th>타입</Table.Th>
                <Table.Th>프롬프트</Table.Th>
                <Table.Th>상태</Table.Th>
                <Table.Th>생성</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {jobs.items.map((job) => (
                <Table.Tr key={job.id}>
                  <Table.Td>
                    <CharacterName id={job.characterId} />
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{job.mediaType}</Badge>
                  </Table.Td>
                  <Table.Td maw={280}>
                    <TableText lines={1}>{job.prompt}</TableText>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[job.status]}>
                      {job.mediaType === "image"
                        ? (WIZARD_LABEL[wizardStep(job)] ??
                          STATUS_LABEL[job.status])
                        : STATUS_LABEL[job.status]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{job.createdAt.slice(0, 10)}</Table.Td>
                  <Table.Td>
                    <JobActions
                      job={job}
                      onOpen={() => openJob(job.id)}
                      onComplete={() => setCompletingJob(job)}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <LoadMore
          hasNextPage={jobs.hasNextPage}
          isFetching={jobs.isFetchingNextPage}
          onLoadMore={() => void jobs.fetchNextPage()}
        />
      </DataPage>
      <GenerationJobCreateModal
        opened={createOpened}
        onClose={() => setCreateOpened(false)}
      />
      <GenerationJobCompleteModal
        job={completingJob}
        onClose={() => setCompletingJob(null)}
      />
    </>
  );
}

function JobActions({
  job,
  onOpen,
  onComplete,
}: {
  job: GenerationJob;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["generation", "list"] });
    void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
  };

  const run = useMutation({
    mutationFn: () => runWorker(job.id),
    onSuccess: invalidate,
  });
  const retry = useMutation({
    mutationFn: () => retryJob(job.id),
    onSuccess: invalidate,
  });

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap">
        {job.mediaType === "image" ? (
          <Button variant="subtle" size="compact-sm" onClick={onOpen}>
            열기
          </Button>
        ) : null}
        {job.mediaType !== "image" && job.status === "queued" ? (
          <Button
            variant="subtle"
            size="compact-sm"
            loading={run.isPending}
            onClick={() => run.mutate()}
          >
            실행
          </Button>
        ) : null}
        {job.mediaType !== "image" && job.status === "running" ? (
          <Button variant="subtle" size="compact-sm" onClick={onComplete}>
            완료 처리
          </Button>
        ) : null}
        {/* 이 잡이 어느 초안의 컷인지 — 실패를 볼 때 가장 먼저 필요한 맥락이다. */}
        {job.draftId ? (
          <Button
            variant="subtle"
            size="compact-sm"
            component={Link}
            to={`/drafts/${encodeURIComponent(job.draftId)}`}
          >
            초안 보기
          </Button>
        ) : null}
        {job.mediaType !== "image" && job.status === "failed" ? (
          <Button
            variant="subtle"
            size="compact-sm"
            color="red"
            loading={retry.isPending}
            onClick={() => retry.mutate()}
          >
            재시도
          </Button>
        ) : null}
      </Group>
      <MutationAlert
        mutation={run}
        success="워커에 실행을 요청했습니다."
        errorTitle="작업을 실행하지 못했습니다"
      />
      <MutationAlert
        mutation={retry}
        success="재시도를 요청했습니다."
        errorTitle="재시도하지 못했습니다"
      />
    </Stack>
  );
}
