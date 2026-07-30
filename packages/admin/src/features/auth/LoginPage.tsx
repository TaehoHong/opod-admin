import {
  Alert,
  Button,
  Card,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useLogin } from "./useSession";

// @mantine/form uncontrolled 모드 (docs/06-architecture.md "Frontend").
export function LoginPage() {
  const loginMutation = useLogin();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "", password: "" },
    validate: {
      email: (value) => (value.includes("@") ? null : "이메일을 확인해 주세요"),
      password: (value) =>
        value.length > 0 ? null : "비밀번호를 입력해 주세요",
    },
  });

  return (
    <Card
      withBorder
      padding="xl"
      maw={380}
      mx="auto"
      mt="15vh"
      component="section"
    >
      <form
        onSubmit={form.onSubmit((values) =>
          loginMutation.mutate({
            email: values.email.trim(),
            password: values.password,
          }),
        )}
      >
        <Stack>
          <Title order={2}>OPOD Admin</Title>
          {loginMutation.isError ? (
            <Alert color="red" role="alert">
              {loginMutation.error.message}
            </Alert>
          ) : null}
          <TextInput
            label="이메일"
            type="email"
            autoComplete="username"
            key={form.key("email")}
            {...form.getInputProps("email")}
          />
          <PasswordInput
            label="비밀번호"
            autoComplete="current-password"
            key={form.key("password")}
            {...form.getInputProps("password")}
          />
          <Button type="submit" loading={loginMutation.isPending}>
            로그인
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
