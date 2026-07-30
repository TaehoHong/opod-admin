import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// 테스트에서도 같은 provider 구성을 쓰기 위해 client 생성을 분리한다.
// 테스트는 retry를 꺼야 실패 경로가 즉시 드러난다
// (docs/05-quality-rules.md "Frontend Target Tests").
export function createQueryClient(options?: { retry?: boolean }) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: options?.retry ?? false },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({
  children,
  queryClient = createQueryClient(),
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  return (
    <MantineProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}
