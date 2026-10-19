import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostAgentsPage } from "./PostAgentsPage";
import { STAGES, type AgentConfig, type AiModel } from "./api";

const endpoint = "/api/admin/v1/post-generation-agents";
const schema = { type: "object", properties: {} };
const models: AiModel[] = [
  {
    id: "1",
    type: "llm",
    provider: "openai-compatible",
    model: "llm-base",
    createdAt: "2026-09-28T00:00:00Z",
  },
  {
    id: "2",
    type: "image",
    provider: "openai",
    model: "gpt-image-2.5-sunburst",
    createdAt: "2026-09-28T00:00:00Z",
  },
];
function config(stage: AgentConfig["stage"], revision = 1): AgentConfig {
  const image = stage === "generation";
  return {
    id: String(revision),
    stage,
    revision,
    aiModelId: image ? "2" : "1",
    model: null,
    provider: image ? "openai" : "openai-compatible",
    effectiveModel: image ? "gpt-image-2.5-sunburst" : "llm-base",
    systemPrompt: image ? null : `Instruction ${revision}`,
    outputSchema: image ? null : schema,
    createdAt: "2026-09-28T00:00:00Z",
  };
}
beforeEach(() => {
  sessionStorage.clear();
  Element.prototype.scrollIntoView = () => {};
});

it("repairs the visible missing image model on the same page, refreshes its status, and saves the natural Agent", async () => {
  const user = userEvent.setup();
  const prompts = {
    post_plan: "plan",
    image_plan: "image",
    image_prompt: "prompt",
    caption: "caption",
    naturalness: "natural",
    requirements: "requirements",
  };
  let generation = {
    ...config("generation", 0),
    id: null,
    aiModelId: null,
    provider: null,
    effectiveModel: null,
  } as AgentConfig;
  const naturalSaves: unknown[] = [];
  server.use(
    http.get(endpoint, () =>
      HttpResponse.json({
        items: STAGES.map((stage) =>
          stage === "generation" ? generation : config(stage),
        ),
      }),
    ),
    http.get(`${endpoint}/models`, () =>
      HttpResponse.json({ items: models, nextCursor: null }),
    ),
    http.get(`${endpoint}/natural/config`, () =>
      HttpResponse.json({ current: null, starters: prompts }),
    ),
    http.get(`${endpoint}/generation/versions`, () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.post(`${endpoint}/generation/versions`, async ({ request }) => {
      const body = await request.json();
      generation = { ...config("generation"), ...(body as object) };
      return HttpResponse.json(generation);
    }),
    http.post(`${endpoint}/natural/config`, async ({ request }) => {
      naturalSaves.push(await request.json());
      return HttpResponse.json({
        revision: "saved",
        schedulerDefault: false,
        planningModel: {
          aiModelId: "1",
          provider: "openai-compatible",
          model: "llm-base",
        },
        reviewModel: {
          aiModelId: "1",
          provider: "openai-compatible",
          model: "llm-base",
        },
        prompts,
      });
    }),
  );
  renderPage(<PostAgentsPage />, {
    path: "/post-generation-agents/post_plan?agent=natural",
    routes: ["/post-generation-agents/:stage"],
  });
  await screen.findByText("이미지 생성 모델을 먼저 저장하세요.");
  expect(screen.queryByRole("tab", { name: "기존 Agent" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "시스템 지침" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "새 Agent 설정 저장" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  expect(naturalSaves).toHaveLength(0);
  for (const name of ["기획·캡션 모델", "사진 검수 모델"]) {
    const input = screen.getByRole("combobox", { name });
    await waitFor(() => expect(input).toBeEnabled());
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("openai-compatible / llm-base");
    expect(input).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: `${name}을 선택하세요.` }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "이미지 생성 모델을 먼저 저장하세요.",
      }),
    ).toBeInTheDocument();
  }
  await user.click(screen.getByRole("button", { name: "새 Agent 설정 저장" }));
  expect(naturalSaves).toHaveLength(0);
  await user.click(
    screen.getByRole("button", { name: "이미지 생성 모델 설정" }),
  );
  let dialog = await screen.findByRole("dialog", {
    name: "공통 이미지 생성 모델 설정",
  });
  await user.click(within(dialog).getByRole("combobox", { name: "기본 모델" }));
  await user.keyboard("{ArrowDown}{Enter}");
  expect(
    within(dialog).getByRole("combobox", { name: "기본 모델" }),
  ).toHaveValue("openai / gpt-image-2.5-sunburst");
  // Dismissing an unsaved image edit must not clear the underlying form's guard.
  await user.click(
    within(dialog).getByRole("button", { name: "이미지 생성 설정 닫기" }),
  );
  await screen.findByRole("dialog", { name: "수정 중인 설정이 있습니다" });
  await user.click(screen.getByRole("button", { name: "이동" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "공통 이미지 생성 모델 설정" }),
    ).toBeNull(),
  );
  await user.click(screen.getByRole("tab", { name: "레퍼런스 Agent" }));
  await screen.findByRole("dialog", { name: "수정 중인 설정이 있습니다" });
  await user.click(screen.getByRole("button", { name: "계속 편집" }));
  await user.click(
    screen.getByRole("button", { name: "이미지 생성 모델 설정" }),
  );
  dialog = await screen.findByRole("dialog", {
    name: "공통 이미지 생성 모델 설정",
  });
  expect(
    within(dialog).getByRole("combobox", { name: "기본 모델" }),
  ).toHaveValue("openai / gpt-image-2.5-sunburst");
  await user.click(
    within(dialog).getByRole("button", { name: "저장하고 적용" }),
  );
  await within(dialog).findByText("적용했습니다.");
  await user.click(
    within(dialog).getByRole("button", { name: "이미지 생성 설정 닫기" }),
  );
  await screen.findByText("openai / gpt-image-2.5-sunburst");
  expect(
    screen.queryByRole("button", {
      name: "이미지 생성 모델을 먼저 저장하세요.",
    }),
  ).toBeNull();
  // Closing the repair modal must preserve the dirty natural form's navigation guard.
  await user.click(screen.getByRole("tab", { name: "레퍼런스 Agent" }));
  await screen.findByRole("dialog", { name: "수정 중인 설정이 있습니다" });
  await user.click(screen.getByRole("button", { name: "계속 편집" }));
  await user.click(screen.getByRole("button", { name: "새 Agent 설정 저장" }));
  await waitFor(() => expect(naturalSaves).toHaveLength(1));
  expect(naturalSaves[0]).toMatchObject({
    planningAiModelId: "1",
    reviewAiModelId: "1",
    expectedRevision: null,
    prompts,
  });
});
