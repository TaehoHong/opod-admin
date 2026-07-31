import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

// 키 삭제는 원클릭 파괴 액션이라 대상과 결과를 보여주고 확인을 받는다
// (docs/04-design-rules.md:69).
export function ClearKeyButton({
  label,
  description,
  loading,
  onConfirm,
}: {
  label: string;
  description: string;
  loading: boolean;
  onConfirm: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button variant="subtle" color="red" size="compact-xs" onClick={open}>
        키 삭제
      </Button>
      <Modal opened={opened} onClose={close} title={label}>
        <Stack gap="sm">
          <Text size="sm">{description}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              취소
            </Button>
            <Button
              color="red"
              loading={loading}
              onClick={() => {
                onConfirm();
                close();
              }}
            >
              삭제
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
