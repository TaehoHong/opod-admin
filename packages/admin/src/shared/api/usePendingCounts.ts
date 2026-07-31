import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./apiClient";

// 처리 대기 큐. 홈의 할 일 카드와 좌측 네비게이션 배지가 같은 숫자를 써야
// 하므로 한 곳에서 센다.
export type PendingQueue =
  "drafts" | "media" | "generation" | "moderation" | "payments";

const PAGE_SIZE = 50;

const QUEUES: Array<{ key: PendingQueue; path: string }> = [
  { key: "drafts", path: `/drafts?status=needs_review&limit=${PAGE_SIZE}` },
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

export type PendingCounts = Record<PendingQueue, PendingCount>;

// 목록 API에 총계가 없어 첫 페이지로 센다. 다음 커서가 있으면 "50+"로 읽도록
// hasMore를 함께 돌려준다.
async function countQueue(path: string): Promise<PendingCount> {
  const page = await apiRequest<{ items: unknown[]; nextCursor?: string }>(
    path,
  );
  return { count: page.items.length, hasMore: Boolean(page.nextCursor) };
}

export function usePendingCounts() {
  return useQuery({
    queryKey: ["pending-counts"],
    queryFn: async (): Promise<PendingCounts> => {
      const results = await Promise.all(
        QUEUES.map((queue) => countQueue(queue.path)),
      );
      return Object.fromEntries(
        QUEUES.map((queue, index) => [queue.key, results[index]]),
      ) as PendingCounts;
    },
  });
}

export function pendingCountLabel(pending?: PendingCount): string {
  if (!pending) return "0";
  return pending.hasMore ? `${pending.count}+` : String(pending.count);
}
