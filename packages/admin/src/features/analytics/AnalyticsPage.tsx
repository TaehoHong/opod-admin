import {
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataPage } from "../../shared/ui/DataPage";
import {
  fetchAnalytics,
  fetchTopHashtags,
  type AnalyticsMetricName,
} from "./api";

const PERIODS = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
];

const METRIC_LABEL: Record<AnalyticsMetricName, string> = {
  "events.count": "사용자 행동",
  "messages.count": "1:1 대화",
  "credits.granted": "크레딧 지급",
  "credits.debited": "크레딧 사용",
  "generation_jobs.count": "생성 job",
};

const METRIC_NOTE: Record<AnalyticsMetricName, string> = {
  "events.count": "기간 내 기록된 사용자 이벤트",
  "messages.count": "기간 내 주고받은 메시지",
  "credits.granted": "운영·결제 지급 합계",
  "credits.debited": "AI 기능 사용 합계",
  "generation_jobs.count": "이미지·영상 생성 요청",
};

const TOP_HASHTAG_LIMIT = 10;

export function AnalyticsPage() {
  const [period, setPeriod] = useState("7");

  const metrics = useQuery({
    queryKey: ["analytics", "metrics", period],
    queryFn: () => fetchAnalytics(Number(period)),
  });
  const hashtags = useQuery({
    queryKey: ["analytics", "hashtags"],
    queryFn: () => fetchTopHashtags(TOP_HASHTAG_LIMIT),
  });

  const metricItems = metrics.data?.metrics ?? [];
  const hashtagItems = hashtags.data?.items ?? [];

  return (
    <DataPage
      title="분석"
      isPending={metrics.isPending || hashtags.isPending}
      error={metrics.error ?? hashtags.error}
      isEmpty={metricItems.length === 0}
      emptyLabel="집계된 지표가 없습니다."
      actions={
        <SegmentedControl
          aria-label="집계 기간"
          data={PERIODS}
          value={period}
          onChange={setPeriod}
        />
      }
    >
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="md">
        {metricItems.map((metric) => (
          <Card key={metric.name} padding="md">
            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase">
                {METRIC_LABEL[metric.name] ?? metric.name}
              </Text>
              {/* 숫자 비교가 목적이라 자릿수를 고정 폭으로 맞춘다. */}
              <Text fz={32} fw={600} ff="monospace">
                {metric.value.toLocaleString()}
              </Text>
              <Text size="xs" c="dimmed">
                {METRIC_NOTE[metric.name] ?? `최근 ${period}일`}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>

      <Stack gap="xs" maw={480}>
        <Title order={5}>상위 해시태그</Title>
        {hashtagItems.length === 0 ? (
          <Text c="dimmed">집계된 해시태그가 없습니다.</Text>
        ) : (
          hashtagItems.map((item) => (
            <Group key={item.hashtag} justify="space-between">
              <Text c="accent.6">#{item.hashtag}</Text>
              <Text fw={600}>{item.postCount.toLocaleString()}</Text>
            </Group>
          ))
        )}
      </Stack>
    </DataPage>
  );
}
