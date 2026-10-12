import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { NaturalAgentPanel } from "./NaturalAgentPanel";
import type { AgentConfig, NaturalConfig } from "./api";

beforeEach(() => sessionStorage.clear());
it("loads structured planning explicitly and saves it without replacing review or caption instructions", async () => {
  const user = userEvent.setup();
  const prompts = {
    post_plan: "old post",
    image_plan: "old image",
    image_prompt: "old prompt",
    caption: "custom caption",
    naturalness: "custom naturalness",
    requirements: "custom requirements",
  };
  const structuredPlanningPrompts = {
    post_plan: "new post",
    image_plan: "new image",
    image_prompt: "new prompt",
  };
  const current: NaturalConfig = {
    revision: "r1",
    schedulerDefault: false,
    planningModel: {
      aiModelId: "1",
      provider: "openai-compatible",
      model: "vision",
    },
    reviewModel: {
      aiModelId: "1",
      provider: "openai-compatible",
      model: "vision",
    },
    prompts,
  };
  const saves: Record<string, unknown>[] = [];
  server.use(
    http.get("/api/admin/v1/post-generation-agents/natural/config", () =>
      HttpResponse.json({
        current,
        starters: prompts,
        structuredPlanningPrompts,
      }),
    ),
    http.post(
      "/api/admin/v1/post-generation-agents/natural/config",
      async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        saves.push(body);
        return HttpResponse.json({ ...current, ...body, revision: "r2" });
      },
    ),
  );
  renderPage(
    <NaturalAgentPanel
      models={[
        {
          id: "1",
          type: "llm",
          provider: "openai-compatible",
          model: "vision",
          createdAt: "2026-10-12",
        },
      ]}
      generation={{ id: "2" } as AgentConfig}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "항목별 기획 지침 불러오기" }),
  );
  expect(saves).toHaveLength(0);
  expect(screen.getByLabelText("이미지 기획 · 레퍼런스 검토 지침")).toHaveValue(
    "new image",
  );
  await user.click(screen.getByRole("button", { name: "새 Agent 설정 저장" }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]).toMatchObject({
    planningContract: "structured-v1",
    expectedRevision: "r1",
    prompts: { ...prompts, ...structuredPlanningPrompts },
  });
});

it("preserves edited instructions on a conflict and resaves against the deliberately refreshed revision", async () => {
  const user = userEvent.setup();
  const endpoint = "/api/admin/v1/post-generation-agents/natural/config";
  let current: NaturalConfig = {
    revision: "r1",
    schedulerDefault: false,
    planningModel: {
      aiModelId: "1",
      provider: "openai-compatible",
      model: "vision",
    },
    reviewModel: {
      aiModelId: "1",
      provider: "openai-compatible",
      model: "vision",
    },
    prompts: {
      post_plan: "saved planning",
      image_plan: "saved image planning",
      image_prompt: "saved prompt",
      caption: "saved caption",
      naturalness: "saved naturalness",
      requirements: "saved requirements",
    },
  };
  const saved: unknown[] = [];
  server.use(
    http.get(endpoint, () =>
      HttpResponse.json({ current, starters: current.prompts }),
    ),
    http.post(endpoint, async ({ request }) => {
      saved.push(await request.json());
      if (saved.length === 1) {
        current = {
          ...current,
          revision: "r2",
          prompts: {
            ...current.prompts,
            post_plan: "another admin's planning",
          },
        };
        return HttpResponse.json(
          { message: "configuration changed" },
          { status: 409 },
        );
      }
      return HttpResponse.json({ ...current, revision: "r3" });
    }),
  );
  const dirty = vi.fn();
  renderPage(
    <NaturalAgentPanel
      models={[
        {
          id: "1",
          type: "llm",
          provider: "openai-compatible",
          model: "vision",
          createdAt: "2026-10-08",
        },
      ]}
      generation={{
        id: "2",
        stage: "generation",
        revision: 1,
        aiModelId: "2",
        provider: "openai",
        effectiveModel: "image",
        model: null,
        systemPrompt: null,
        outputSchema: null,
        createdAt: null,
      }}
      onDirtyChange={dirty}
    />,
  );
  await screen.findByText("설정 저장됨");
  await user.click(screen.getByRole("button", { name: /^1. 게시물 기획$/ }));
  const input = screen.getByLabelText("게시물 기획 지침");
  await user.clear(input);
  await user.type(input, "my reviewed planning");
  expect(dirty).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole("button", { name: "새 Agent 설정 저장" }));
  await user.click(
    await screen.findByRole("button", { name: "최신 설정 확인 · 입력 유지" }),
  );
  await screen.findByText("최신 저장 버전을 확인했습니다.", { exact: false });
  expect(input).toHaveValue("my reviewed planning");
  await user.click(screen.getByRole("button", { name: "새 Agent 설정 저장" }));
  await waitFor(() => expect(saved).toHaveLength(2));
  expect(saved[1]).toMatchObject({
    expectedRevision: "r2",
    prompts: { post_plan: "my reviewed planning" },
  });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});

const starters = {
  post_plan: "plan",
  image_plan: "image",
  image_prompt: "prompt",
  caption: "caption",
  naturalness: "naturalness",
  requirements: "requirements",
};
const configuredGeneration: AgentConfig = {
  id: "2",
  stage: "generation",
  revision: 1,
  aiModelId: "2",
  provider: "openai",
  effectiveModel: "image",
  model: null,
  systemPrompt: null,
  outputSchema: null,
  createdAt: null,
};
it("blocks missing models without a save request and focuses an actionable summary and field", async () => {
  const user = userEvent.setup();
  let requests = 0;
  server.use(
    http.get("/api/admin/v1/post-generation-agents/natural/config", () =>
      HttpResponse.json({ current: null, starters }),
    ),
    http.post("/api/admin/v1/post-generation-agents/natural/config", () => {
      requests++;
      return HttpResponse.json({});
    }),
  );
  renderPage(
    <NaturalAgentPanel models={[]} generation={configuredGeneration} />,
  );
  await user.click(
    await screen.findByRole("button", { name: "새 Agent 설정 저장" }),
  );
  const summary = screen.getByRole("alert");
  await waitFor(() => expect(summary).toHaveFocus());
  await user.click(
    screen.getByRole("button", { name: "기획·캡션 모델을 선택하세요." }),
  );
  expect(
    screen.getByRole("combobox", { name: "기획·캡션 모델" }),
  ).toHaveFocus();
  expect(requests).toBe(0);
});
it("distinguishes configuration fetch failure from missing setup and offers retry", async () => {
  const user = userEvent.setup();
  let requests = 0;
  server.use(
    http.get("/api/admin/v1/post-generation-agents/natural/config", () => {
      requests++;
      return requests === 1
        ? HttpResponse.json({ message: "unavailable" }, { status: 500 })
        : HttpResponse.json({ current: null, starters });
    }),
  );
  renderPage(
    <NaturalAgentPanel models={[]} generation={configuredGeneration} />,
  );
  await screen.findByText("새 Agent 설정을 불러오지 못했습니다.");
  expect(screen.queryByText("초기 설정 필요")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "새 Agent 설정 다시 불러오기" }),
  );
  await screen.findByText("초기 설정 필요");
});
