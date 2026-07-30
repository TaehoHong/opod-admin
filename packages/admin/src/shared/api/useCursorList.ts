import { useInfiniteQuery } from "@tanstack/react-query";

// 서버 목록 계약은 { items, nextCursor } 하나로 통일돼 있다
// (src/domain/database/page.ts). 화면마다 같은 infinite query 설정을
// 반복하지 않는다.

export type CursorPage<T> = {
  items: T[];
  nextCursor?: string;
};

export function useCursorList<T>(
  queryKey: readonly unknown[],
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
) {
  const query = useInfiniteQuery<CursorPage<T>>({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam as string | undefined),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

export function toQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  return query.size > 0 ? `?${query.toString()}` : "";
}
