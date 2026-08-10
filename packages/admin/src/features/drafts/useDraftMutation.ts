import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Draft } from "./api";

export function draftDetailKey(draftId: string) {
  return ["drafts", "detail", draftId] as const;
}

// 초안의 모든 변경 endpoint가 갱신된 draft 전체를 돌려준다. 응답을 그대로
// 캐시에 넣으면 재조회 없이 화면이 맞춰지고, 목록과 대기 배지만 무효화하면
// 된다.
// 인자 없는 액션(승인, 재생성 등)이 mutate()로 호출되도록 TVars는 void가 기본.
export function useDraftMutation<TVars = void>(
  draftId: string,
  mutationFn: (vars: TVars) => Promise<Draft>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (draft) => {
      queryClient.setQueryData(draftDetailKey(draftId), draft);
      void queryClient.invalidateQueries({ queryKey: ["drafts", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["post-work-items"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
    },
  });
}
