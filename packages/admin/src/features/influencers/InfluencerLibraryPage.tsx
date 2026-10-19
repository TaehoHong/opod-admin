import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { previewUrl } from "../../shared/media/previewUrl";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { fetchInfluencers, type Influencer } from "./api";
import { InfluencerMediaModal } from "./InfluencerMediaModal";
import classes from "./InfluencerMediaModal.module.css";

export function InfluencerLibraryPage() {
  const accounts = useCursorList(["influencers"], fetchInfluencers);
  const [selected, setSelected] = useState<Influencer | null>(null);
  return (
    <>
      <DataPage
        title="수집 라이브러리"
        isPending={accounts.isPending}
        error={accounts.error}
        isEmpty={accounts.items.length === 0}
        emptyLabel="등록된 SNS 계정이 없습니다."
        actions={
          <Group gap="xs">
            <Button
              variant="default"
              loading={accounts.isFetching}
              onClick={() => void accounts.refetch()}
            >
              새로고침
            </Button>
            <Button component={Link} to="/sns-references" variant="default">
              캐릭터별 연결 보기
            </Button>
          </Group>
        }
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            계정별로 수집한 사진·영상 썸네일과 분석 내용을 확인합니다. 캐릭터
            연결을 해제한 계정도 보관됩니다.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {accounts.items.map((account) => (
              <Paper key={account.id} p="lg" withBorder>
                <Stack gap="sm">
                  <Badge color="ink" variant="light">
                    {account.platform}
                  </Badge>
                  <Text fw={650} className={classes.wrap}>
                    @{account.username}
                  </Text>
                  {previewUrl(account.url) ? (
                    <Anchor
                      href={previewUrl(account.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="sm"
                    >
                      계정 원본 열기
                    </Anchor>
                  ) : null}
                  <Button
                    variant="default"
                    onClick={() => setSelected(account)}
                  >
                    수집 미디어 보기
                  </Button>
                </Stack>
              </Paper>
            ))}
          </SimpleGrid>
          <LoadMore
            hasNextPage={Boolean(accounts.hasNextPage)}
            isFetching={accounts.isFetching}
            onLoadMore={() => void accounts.fetchNextPage()}
          />
        </Stack>
      </DataPage>
      {selected ? (
        <InfluencerMediaModal
          key={selected.id}
          account={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
