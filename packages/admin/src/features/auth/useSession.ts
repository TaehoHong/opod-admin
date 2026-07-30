import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/apiClient";
import {
  fetchCurrentAdmin,
  login,
  logout,
  type Admin,
  type LoginInput,
} from "./api";

export const sessionQueryKey = ["session"] as const;

// 로그인 여부는 서버만 안다 — cookie를 읽을 수 없으므로 /auth/me 결과를
// 단일 진실로 쓴다. 401은 "로그아웃 상태"라는 정상 응답이므로 재시도하지
// 않고 null로 정규화한다.
export function useSession() {
  return useQuery<Admin | null>({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        return (await fetchCurrentAdmin()).admin;
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: (result) => {
      queryClient.setQueryData(sessionQueryKey, result.admin);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      // 세션이 끊겼으니 캐시에 남은 다른 화면 데이터도 버린다.
      void queryClient.invalidateQueries();
    },
  });
}
