import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  startMediaUpload,
  type MediaType,
  type MediaUploadTicket,
} from "./api";

const MEDIA_TYPES = [
  { value: "image", label: "image" },
  { value: "video", label: "video" },
];

// presigned URL을 발급하고 pending media를 만든다. 발급 결과를 화면에 남기지
// 않으면 운영자가 실제 업로드를 끝낼 수 없으므로 URL과 만료 시각을 보여준다
// (docs/04-design-rules.md:66 — 완료 결과와 다음 행동을 구분한다).
export function MediaUploadModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [ticket, setTicket] = useState<MediaUploadTicket | null>(null);

  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      mediaType: "image" as MediaType,
      contentType: "",
      fileName: "",
      byteSize: "",
      width: "",
      height: "",
    },
    validate: {
      contentType: (value, values) =>
        value.trim().toLowerCase().startsWith(`${values.mediaType}/`)
          ? null
          : `Content-Type은 ${values.mediaType}/ 로 시작해야 합니다`,
      fileName: (value) =>
        value.trim().length === 0 ? "파일 이름을 입력해 주세요" : null,
    },
  });

  const start = useMutation({
    mutationFn: (values: typeof form.values) =>
      startMediaUpload({
        mediaType: values.mediaType,
        contentType: values.contentType.trim(),
        fileName: values.fileName.trim(),
        ...optionalNumber("byteSize", values.byteSize),
        ...optionalNumber("width", values.width),
        ...optionalNumber("height", values.height),
      }),
    onSuccess: (result) => {
      setTicket(result);
      void queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });

  const close = () => {
    setTicket(null);
    start.reset();
    form.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="미디어 업로드 시작" size="lg">
      <form onSubmit={form.onSubmit((values) => start.mutate(values))}>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            S3 presigned PUT URL을 발급하고 pending 미디어를 만듭니다. 업로드를
            끝낸 뒤 목록에서 업로드 확정을 눌러야 사용 가능해집니다.
          </Text>
          <Group grow align="flex-start">
            <Select
              label="미디어 타입"
              data={MEDIA_TYPES}
              allowDeselect={false}
              key={form.key("mediaType")}
              {...form.getInputProps("mediaType")}
            />
            <TextInput
              label="Content-Type"
              placeholder="image/png"
              key={form.key("contentType")}
              {...form.getInputProps("contentType")}
            />
          </Group>
          <TextInput
            label="파일 이름"
            placeholder="photo.png"
            key={form.key("fileName")}
            {...form.getInputProps("fileName")}
          />
          <Group grow align="flex-start">
            <NumberInput
              label="바이트"
              description="선택"
              min={1}
              key={form.key("byteSize")}
              {...form.getInputProps("byteSize")}
            />
            <NumberInput
              label="가로"
              description="선택"
              min={1}
              key={form.key("width")}
              {...form.getInputProps("width")}
            />
            <NumberInput
              label="세로"
              description="선택"
              min={1}
              key={form.key("height")}
              {...form.getInputProps("height")}
            />
          </Group>

          {start.isError ? (
            <Alert color="red" role="alert" title="발급하지 못했습니다">
              {start.error.message}
            </Alert>
          ) : null}

          {ticket ? (
            <Alert color="teal" title="presigned URL을 발급했습니다">
              <Stack gap={6}>
                <Text size="sm">
                  {ticket.method} 요청으로 아래 URL에 파일을 올린 뒤 업로드
                  확정을 누르세요. 만료{" "}
                  {ticket.expiresAt.replace("T", " ").slice(0, 19)}
                </Text>
                <Code block>{ticket.uploadUrl}</Code>
                <Code block>
                  {Object.entries(ticket.headers)
                    .map(([name, value]) => `${name}: ${value}`)
                    .join("\n")}
                </Code>
              </Stack>
            </Alert>
          ) : null}

          <Group justify="flex-end">
            <Button variant="default" type="button" onClick={close}>
              {ticket ? "닫기" : "취소"}
            </Button>
            <Button type="submit" loading={start.isPending}>
              URL 발급
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// NumberInput은 비어 있으면 빈 문자열을 준다. 서버 DTO가 선택 항목이므로
// 값이 있을 때만 실어 보낸다.
function optionalNumber(
  key: "byteSize" | "width" | "height",
  value: string | number,
): Record<string, number> {
  const parsed = typeof value === "number" ? value : Number(value);
  return value === "" || !Number.isFinite(parsed) ? {} : { [key]: parsed };
}
