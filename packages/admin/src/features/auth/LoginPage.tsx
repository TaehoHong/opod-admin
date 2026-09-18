import {
  Alert,
  Button,
  Card,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ArrowRight, LockKey } from "@phosphor-icons/react";
import { useForm } from "@mantine/form";
import { useLogin } from "./useSession";
import classes from "./LoginPage.module.css";

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
    <main className={classes.page}>
      <section className={classes.brandPanel} aria-label="OPOD 운영 콘솔 소개">
        <div className={classes.wordmark}>
          <span className={classes.brandMark} aria-hidden>
            OP
          </span>
          OPOD Admin
        </div>
        <div className={classes.brandCopy}>
          <div className={classes.eyebrow}>One place for operations</div>
          <h1 className={classes.brandTitle}>캐릭터의 세계를 운영하는 곳.</h1>
          <p className={classes.brandDescription}>
            콘텐츠 제작부터 이미지 생성, 신고와 결제까지 OPOD의 모든 운영 흐름을
            한곳에서 확인하고 이어갑니다.
          </p>
        </div>
        <div className={classes.brandFooter}>Internal access only</div>
      </section>
      <section className={classes.formPanel}>
        <Card className={classes.formCard} padding="xl" component="section">
          <form
            onSubmit={form.onSubmit((values) =>
              loginMutation.mutate({
                email: values.email.trim(),
                password: values.password,
              }),
            )}
          >
            <Stack gap="lg">
              <Stack gap={6}>
                <LockKey size={24} weight="duotone" aria-hidden />
                <Title className={classes.formTitle} order={2}>
                  운영 콘솔 로그인
                </Title>
                <Text className={classes.helper} size="sm">
                  승인된 관리자 계정으로 로그인해 주세요.
                </Text>
              </Stack>
              {loginMutation.isError ? (
                <Alert color="red" role="alert" title="로그인하지 못했습니다">
                  {loginMutation.error.message}
                </Alert>
              ) : null}
              <TextInput
                label="이메일"
                type="email"
                autoComplete="username"
                size="md"
                key={form.key("email")}
                {...form.getInputProps("email")}
              />
              <PasswordInput
                label="비밀번호"
                autoComplete="current-password"
                size="md"
                key={form.key("password")}
                {...form.getInputProps("password")}
              />
              <Button
                className={classes.submit}
                type="submit"
                size="md"
                rightSection={<ArrowRight size={18} aria-hidden />}
                loading={loginMutation.isPending}
              >
                로그인
              </Button>
            </Stack>
          </form>
        </Card>
      </section>
    </main>
  );
}
