import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchUsers, type UserListItem } from "../users/api";
import { grantCredits, type CreditGrant } from "./api";

const AMOUNT_PRESETS = [100, 500, 1000];

export function CreditGrantModal({
  opened,
  onClose,
  initialUserId,
  initialUser,
}: {
  opened: boolean;
  onClose: () => void;
  initialUserId?: string;
  initialUser?: Pick<UserListItem, "id" | "displayName" | "email">;
}) {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ["credit-user-options"],
    queryFn: () => fetchUsers({ limit: "50" }),
    staleTime: 5 * 60 * 1000,
    enabled: opened,
  });
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      userId: initialUserId ?? "",
      amount: "" as string | number,
      reason: "",
      externalReference: "",
    },
    validate: {
      userId: required("사용자를 선택해 주세요"),
      amount: (value) =>
        typeof value === "number" && Number.isInteger(value) && value > 0
          ? null
          : "금액은 1 이상의 정수여야 합니다",
      reason: required("지급 사유를 입력해 주세요"),
    },
  });

  useEffect(() => {
    if (opened) {
      form.setFieldValue("userId", initialUserId ?? "");
    }
  }, [opened, initialUserId]);

  const grant = useMutation({
    mutationFn: (values: typeof form.values) =>
      grantCredits(toGrantBody(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["credits"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      form.reset();
      onClose();
    },
  });

  const close = () => {
    if (grant.isPending) return;
    grant.reset();
    form.reset();
    onClose();
  };

  const userOptions = (users.data?.items ?? []).map(toUserOption);
  if (
    initialUser &&
    !userOptions.some((option) => option.value === initialUser.id)
  ) {
    userOptions.unshift(toUserOption(initialUser));
  }

  return (
    <Modal opened={opened} onClose={close} title="크레딧 지급" size="md">
      <form onSubmit={form.onSubmit((values) => grant.mutate(values))}>
        <Stack gap="sm">
          <Select
            label="사용자"
            placeholder={users.isPending ? "불러오는 중…" : "선택하세요"}
            data={userOptions}
            searchable
            disabled={users.isPending}
            key={form.key("userId")}
            {...form.getInputProps("userId")}
          />
          {users.isError ? (
            <Alert
              color="red"
              role="alert"
              title="사용자를 불러오지 못했습니다"
            >
              {users.error.message}
            </Alert>
          ) : null}
          <NumberInput
            label="금액"
            min={1}
            step={1}
            allowDecimal={false}
            key={form.key("amount")}
            {...form.getInputProps("amount")}
          />
          {/* 자주 쓰는 금액은 눌러서 채운다 — 지급은 손이 자주 가는 작업이다. */}
          <Group gap="xs">
            {AMOUNT_PRESETS.map((amount) => (
              <Button
                key={amount}
                variant="default"
                size="compact-sm"
                onClick={() => form.setFieldValue("amount", amount)}
              >
                +{amount.toLocaleString()}
              </Button>
            ))}
          </Group>
          <TextInput
            label="사유"
            placeholder="admin grant"
            key={form.key("reason")}
            {...form.getInputProps("reason")}
          />
          <TextInput
            label="외부 참조 (선택)"
            placeholder="support-123"
            key={form.key("externalReference")}
            {...form.getInputProps("externalReference")}
          />
          {grant.isError ? (
            <Alert color="red" role="alert" title="지급하지 못했습니다">
              {grant.error.message}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              type="button"
              onClick={close}
              disabled={grant.isPending}
            >
              취소
            </Button>
            <Button type="submit" loading={grant.isPending}>
              지급
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function toUserOption(
  user: Pick<UserListItem, "id" | "displayName" | "email">,
) {
  return {
    value: user.id,
    label: user.email
      ? `${user.displayName} (${user.email})`
      : user.displayName || user.id,
  };
}

function required(message: string) {
  return (value: string) => (value.trim() ? null : message);
}

function toGrantBody(values: {
  userId: string;
  amount: string | number;
  reason: string;
  externalReference: string;
}): CreditGrant {
  const externalReference = values.externalReference.trim();
  return {
    userId: values.userId,
    amount: Number(values.amount),
    reason: values.reason.trim(),
    ...(externalReference ? { externalReference } : {}),
  };
}
