import { Badge, Group, List, Spoiler, Stack, Text } from "@mantine/core";
import type { DraftConcept } from "./api";

// ② 기획 결과. 입력 스냅샷은 요약만 보이고 상세는 접어 둔다
// (docs/04-design-rules.md:12).
export function DraftPlanSummary({ concept }: { concept: DraftConcept }) {
  const plan = concept.plan ?? {};
  const input = concept.planInput;
  const shots = plan.shots ?? [];

  const inputSummary = input
    ? `페르소나 ${input.personas?.length ?? 0} · 메모리 ${
        input.memories?.length ?? 0
      } · 최근 캡션 ${input.recentCaptions?.length ?? 0} · 장면 힌트 ${
        input.sceneHint ? "있음" : "없음"
      }`
    : "입력 스냅샷 없음";

  return (
    <Stack gap="xs">
      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase">
          입력
        </Text>
        <Text size="sm">{inputSummary}</Text>
        {concept.plannerName ? (
          <Text size="xs" c="dimmed">
            플래너: {concept.plannerName}
          </Text>
        ) : null}
      </Stack>

      {input ? (
        <Spoiler maxHeight={0} showLabel="입력 상세 보기" hideLabel="접기">
          <Stack gap="xs" pt="xs">
            <InputList
              label="페르소나"
              items={(input.personas ?? [])
                .map((persona) => persona?.title)
                .filter((title): title is string => Boolean(title))}
            />
            <InputList label="메모리" items={input.memories ?? []} />
            <InputList label="최근 캡션" items={input.recentCaptions ?? []} />
          </Stack>
        </Spoiler>
      ) : null}

      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase">
          출력
        </Text>
        <Text size="sm">
          {plan.caption ? `“${plan.caption}”` : "캡션 없음"}
        </Text>
      </Stack>

      {plan.hashtags?.length ? (
        <Group gap={4}>
          {plan.hashtags.map((tag) => (
            <Badge key={tag} variant="light">
              #{tag}
            </Badge>
          ))}
        </Group>
      ) : null}

      {shots.length ? (
        <List type="ordered" size="sm">
          {shots.map((shot, index) => (
            <List.Item key={index}>{shot?.scene ?? ""}</List.Item>
          ))}
        </List>
      ) : null}
    </Stack>
  );
}

function InputList({ label, items }: { label: string; items: string[] }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          —
        </Text>
      ) : (
        <List size="sm">
          {items.map((item, index) => (
            <List.Item key={index}>{item}</List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}
