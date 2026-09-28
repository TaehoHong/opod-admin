import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoadMore } from "../../shared/ui/DataPage";
import { useCursorList } from "../../shared/api/useCursorList";
import { createModel, fetchModels, type AiModel } from "./api";
export function ModelManager() {
  const cache = useQueryClient();
  const models = useCursorList(["post-agent-models"], fetchModels);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      type: "llm" as AiModel["type"],
      provider: "openai-compatible",
      model: "",
    },
    validate: {
      provider: (value) => (value.trim() ? null : "공급자를 입력하세요."),
      model: (value) => (value.trim() ? null : "모델명을 입력하세요."),
    },
  });
  const create = useMutation({
    mutationFn: createModel,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["post-agent-models"] });
      form.setFieldValue("model", "");
    },
  });
  return (
    <Stack gap="lg">
      <Text size="sm">
        등록한 모델을 여러 Agent에서 선택할 수 있습니다. API 주소와 키는 기존
        설정 화면에서 관리합니다.
      </Text>
      <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
        <Stack>
          <Select
            label="모델 유형"
            data={[
              { value: "llm", label: "LLM" },
              { value: "image", label: "이미지" },
            ]}
            allowDeselect={false}
            key={form.key("type")}
            {...form.getInputProps("type")}
            onChange={(value) => {
              form.setFieldValue("type", value as AiModel["type"]);
              form.setFieldValue(
                "provider",
                value === "image" ? "openai" : "openai-compatible",
              );
            }}
            disabled={create.isPending}
          />
          <TextInput
            label="공급자"
            description="LLM: openai-compatible · 이미지: openai, fal, opod-flux"
            maxLength={100}
            key={form.key("provider")}
            {...form.getInputProps("provider")}
            disabled={create.isPending}
          />
          <TextInput
            label="모델명"
            maxLength={512}
            key={form.key("model")}
            {...form.getInputProps("model")}
            disabled={create.isPending}
          />
          {create.error ? (
            <Alert color="red" role="alert" title="모델을 등록하지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}
          <Group>
            <Button type="submit" loading={create.isPending}>
              모델 등록
            </Button>
            {create.isSuccess ? (
              <Text role="status" c="teal" size="sm">
                등록했습니다.
              </Text>
            ) : null}
          </Group>
        </Stack>
      </form>
      {models.error ? (
        <Alert role="alert" color="red">
          {models.error.message}
          <Button variant="default" onClick={() => void models.refetch()}>
            다시 시도
          </Button>
        </Alert>
      ) : null}
      <Table.ScrollContainer minWidth={460}>
        <Table captionSide="top">
          <caption>등록된 모델</caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>유형</Table.Th>
              <Table.Th>공급자</Table.Th>
              <Table.Th>모델</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {models.items.map((model) => (
              <Table.Tr key={model.id}>
                <Table.Td>{model.type === "llm" ? "LLM" : "이미지"}</Table.Td>
                <Table.Td>{model.provider}</Table.Td>
                <Table.Td>{model.model}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!models.isPending && !models.items.length ? (
        <Text role="status">등록된 모델이 없습니다.</Text>
      ) : null}
      <LoadMore
        hasNextPage={!!models.hasNextPage}
        isFetching={models.isFetchingNextPage}
        onLoadMore={() => void models.fetchNextPage()}
      />
    </Stack>
  );
}
