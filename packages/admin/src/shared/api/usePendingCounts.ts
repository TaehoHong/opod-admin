import { useQueries } from "@tanstack/react-query";
import { apiRequest } from "./apiClient";

// 처리 대기 큐. 홈의 할 일 카드와 좌측 네비게이션 배지가 같은 숫자를 써야
// 하므로 한 곳에서 센다.
export type PendingQueue =
  "posts" | "media" | "generation" | "moderation" | "payments";

const PAGE_SIZE = 50;

const QUEUES: Array<{ key: PendingQueue; path: string }> = [
  {
    key: "posts",
    path: `/post-work-items?filter=needs_action&limit=${PAGE_SIZE}`,
  },
  { key: "media", path: `/media?uploaded=false&limit=${PAGE_SIZE}` },
  {
    key: "generation",
    path: `/generation/jobs?status=failed&limit=${PAGE_SIZE}`,
  },
  {
    key: "moderation",
    path: `/moderation/reports?status=submitted&limit=${PAGE_SIZE}`,
  },
  { key: "payments", path: "/payments/reconciliation?status=mismatch" },
];

export type PendingCount = { count: number; hasMore: boolean };

export type PendingCounts = Partial<Record<PendingQueue, PendingCount>>;

// 목록 API에 총계가 없어 첫 페이지로 센다. 다음 커서가 있으면 "50+"로 읽도록
// hasMore를 함께 돌려준다.
async function countQueue(path: string): Promise<PendingCount> {
  const page = await apiRequest<{ items: unknown[]; nextCursor?: string }>(
    path,
  );
  return { count: page.items.length, hasMore: Boolean(page.nextCursor) };
}

// 큐마다 따로 조회한다. 한 API가 죽어도 나머지 숫자는 그대로 보여야 하고,
// 죽은 큐는 0이 아니라 "집계 실패"로 드러나야 한다.
export function usePendingCounts() {
  const results = useQueries({
    queries: QUEUES.map((queue) => ({
      queryKey: ["pending-counts", queue.key],
      queryFn: () => countQueue(queue.path),
    })),
  });

  const data: PendingCounts = {};
  const failedQueues: PendingQueue[] = [];
  results.forEach((result, index) => {
    const key = QUEUES[index].key;
    if (result.data) {
      data[key] = result.data;
    }
    if (result.error) {
      failedQueues.push(key);
    }
  });

  return {
    data,
    failedQueues,
    // 아직 아무 큐도 답하지 않은 동안만 대기로 본다.
    isPending: results.every((result) => result.isPending),
  };
}

export function pendingCountLabel(pending?: PendingCount): string {
  if (!pending) return "0";
  return pending.hasMore ? `${pending.count}+` : String(pending.count);
}

export const PENDING_QUEUE_LABEL: Record<PendingQueue, string> = {
  posts: "게시물",
  media: "미디어",
  generation: "생성 작업",
  moderation: "신고",
  payments: "결제 정산",
};
