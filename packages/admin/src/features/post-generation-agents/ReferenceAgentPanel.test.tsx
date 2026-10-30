import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { ReferenceAgentPanel } from "./ReferenceAgentPanel";
Element.prototype.scrollIntoView = () => {};
beforeEach(() =>
  server.use(
    http.get("/api/admin/v1/post-generation-agents/models", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
  ),
);
const endpoint = "/api/admin/v1/post-generation-agents/reference/config";
it("saves the selected search limit and reloads the persisted value", async () => {
  let current = {
    revision: null as string | null,
    selection: { batchSize: 12, maxAttempts: 1 },
  };
  let body: unknown;
  server.use(
    http.get(endpoint, () => HttpResponse.json({ current })),
    http.post(endpoint, async ({ request }) => {
      body = await request.json();
      current = {
        revision: "saved",
        selection: { batchSize: 12, maxAttempts: 3 },
      };
      return HttpResponse.json(current);
    }),
  );
  const view = renderPage(<ReferenceAgentPanel onDirtyChange={vi.fn()} />);
  const input = await screen.findByRole("combobox", { name: "최대 탐색 횟수" });
  expect(input).toHaveValue("1");
  const user = userEvent.setup();
  await user.click(input);
  await user.click(await screen.findByText("3", { exact: true }));
  await user.type(
    screen.getByRole("textbox", { name: "② 이미지 프롬프트 시스템 지침" }),
    "unsaved instruction",
  );
  await user.click(screen.getByRole("button", { name: "탐색 설정 저장" }));
  await waitFor(() =>
    expect(body).toEqual({ expectedRevision: null, maxAttempts: 3 }),
  );
  expect(
    screen.getByRole("textbox", { name: "② 이미지 프롬프트 시스템 지침" }),
  ).toHaveValue("unsaved instruction");
  view.unmount();
  renderPage(<ReferenceAgentPanel onDirtyChange={vi.fn()} />);
  expect(
    await screen.findByRole("combobox", { name: "최대 탐색 횟수" }),
  ).toHaveValue("3");
});
it.each([500, 409])(
  "preserves input when save fails with %s",
  async (status) => {
    server.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          current: {
            revision: "old",
            selection: { batchSize: 12, maxAttempts: 1 },
          },
        }),
      ),
      http.post(endpoint, () =>
        HttpResponse.json({ message: "저장 오류" }, { status }),
      ),
    );
    renderPage(<ReferenceAgentPanel onDirtyChange={vi.fn()} />);
    const input = await screen.findByRole("combobox", {
      name: "최대 탐색 횟수",
    });
    const user = userEvent.setup();
    await user.click(input);
    await user.click(await screen.findByText("3", { exact: true }));
    await user.click(screen.getByRole("button", { name: "탐색 설정 저장" }));
    await screen.findByText("저장 오류");
    expect(input).toHaveValue("3");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "탐색 설정 저장" }),
      ).toBeEnabled(),
    );
  },
);
it("requires explicit models before saving editable starter instructions and preserves the complete configuration on reload", async () => {
  const stages = ["reference_select", "image_prompt", "caption"] as const;
  const starters = Object.fromEntries(
    stages.map((stage) => [
      stage,
      { systemPrompt: `${stage} proposal`, outputSchema: {} },
    ]),
  );
  let current: Record<string, unknown> = {
    revision: null,
    selection: { batchSize: 12, maxAttempts: 1 },
  };
  let saved: Record<string, unknown> | undefined;
  server.use(
    http.get(endpoint, () => HttpResponse.json({ current, starters })),
    http.get("/api/admin/v1/post-generation-agents/models", () =>
      HttpResponse.json({
        items: [
          {
            id: "7",
            type: "llm",
            provider: "openai-compatible",
            model: "selected-model",
            createdAt: "now",
          },
          {
            id: "8",
            type: "image",
            provider: "image-provider",
            model: "image-model",
            createdAt: "now",
          },
        ],
        nextCursor: null,
      }),
    ),
    http.post(endpoint, async ({ request }) => {
      saved = (await request.json()) as Record<string, unknown>;
      current = {
        revision: "full",
        selection: { batchSize: 12, maxAttempts: 1 },
        stages: saved.stages,
        generation: {
          id: "1",
          revision: 2,
          aiModelId: "8",
          provider: "image-provider",
          effectiveModel: "image-model",
        },
      };
      return HttpResponse.json(current);
    }),
  );
  const view = renderPage(<ReferenceAgentPanel onDirtyChange={vi.fn()} />);
  const user = userEvent.setup();
  await screen.findByText(
    "지침 초안입니다. 각 단계의 모델과 지침을 확인하고 저장해야 실행에 사용할 수 있습니다.",
  );
  const save = screen.getByRole("button", { name: "설정 저장" });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  expect(await screen.findAllByText("모델을 선택하세요.")).toHaveLength(3);
  expect(saved).toBeUndefined();
  for (const label of ["① 원본 선택", "② 이미지 프롬프트", "③ 캡션"]) {
    await user.click(screen.getByRole("combobox", { name: `${label} 모델` }));
    await user.keyboard("{ArrowDown}{Enter}");
  }
  await user.click(screen.getByRole("combobox", { name: "이미지 생성 모델" }));
  await user.keyboard("{ArrowDown}{Enter}");
  await user.type(
    screen.getByRole("textbox", { name: "② 이미지 프롬프트 시스템 지침" }),
    " edited",
  );
  await user.click(save);
  await waitFor(() =>
    expect(saved).toMatchObject({
      expectedRevision: null,
      maxAttempts: 1,
      generationAiModelId: "8",
      stages: {
        reference_select: {
          aiModelId: "7",
          systemPrompt: "reference_select proposal",
        },
        image_prompt: {
          aiModelId: "7",
          systemPrompt: "image_prompt proposal edited",
        },
        caption: { aiModelId: "7", systemPrompt: "caption proposal" },
      },
    }),
  );
  view.unmount();
  renderPage(<ReferenceAgentPanel onDirtyChange={vi.fn()} />);
  expect(
    await screen.findByRole("textbox", {
      name: "② 이미지 프롬프트 시스템 지침",
    }),
  ).toHaveValue("image_prompt proposal edited");
  expect(
    screen.getByRole("combobox", { name: "이미지 생성 모델" }),
  ).toHaveValue("image-provider / image-model");
});
