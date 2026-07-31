import { SimpleGrid } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { DataPage } from "../../shared/ui/DataPage";
import { GenerationSettingsForm } from "./GenerationSettingsForm";
import { SettingsChangesTable } from "./SettingsChangesTable";
import { WorkerCard } from "./WorkerCard";
import {
  fetchGenerationSettings,
  fetchQueuedJobs,
  fetchSettingChanges,
} from "./api";

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ["settings", "generation"],
    queryFn: fetchGenerationSettings,
  });
  const changes = useQuery({
    queryKey: ["settings", "changes"],
    queryFn: fetchSettingChanges,
  });
  // 대기 작업 수는 "지금 수동 실행할 것이 있는지"만 알려주면 되므로 첫 페이지로
  // 충분하다.
  const queued = useQuery({
    queryKey: ["settings", "queued-jobs"],
    queryFn: fetchQueuedJobs,
  });

  return (
    <DataPage
      title="설정"
      isPending={settings.isPending}
      error={settings.error}
    >
      {settings.data ? (
        <>
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <GenerationSettingsForm settings={settings.data} />
            <WorkerCard
              settings={settings.data}
              queuedCount={queued.data?.items.length ?? 0}
            />
          </SimpleGrid>
          <SettingsChangesTable changes={changes.data?.items ?? []} />
        </>
      ) : null}
    </DataPage>
  );
}
