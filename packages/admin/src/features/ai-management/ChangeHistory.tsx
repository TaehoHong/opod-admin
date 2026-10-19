import { Accordion, Stack, Text } from "@mantine/core";
import type { AiConfig } from "./api";

export function ChangeHistory({ changes }: Pick<AiConfig, "changes">) {
  return (
    <Accordion variant="default">
      <Accordion.Item value="changes">
        <Accordion.Control>최근 변경 이력</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {changes.length ? (
              changes.map((change, index) => (
                <div key={`${change.at}-${index}`}>
                  <Text size="sm">{change.summary}</Text>
                  <Text size="xs" c="dimmed">
                    {new Date(change.at).toLocaleString("ko-KR")} ·{" "}
                    {change.actor}
                  </Text>
                </div>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                변경 이력이 없습니다.
              </Text>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
