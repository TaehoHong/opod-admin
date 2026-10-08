import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { PostAgentsPage } from "./PostAgentsPage";
import { STAGES, type AgentConfig, type AgentInput, type AiModel } from "./api";

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
function fixture() {
  let current = config("post_plan");
  const versions = [current];
  server.use(
    http.get(`${endpoint}/natural/config`, () =>
      HttpResponse.json({ current: null, starters: {} }),
    ),
    http.get(endpoint, () =>
      HttpResponse.json({
        items: STAGES.map((stage) =>
          stage === "post_plan" ? current : config(stage),
        ),
      }),
    ),
    http.get(`${endpoint}/models`, () =>
      HttpResponse.json({ items: models, nextCursor: null }),
    ),
    http.get(`${endpoint}/:stage/versions`, () =>
      HttpResponse.json({ items: versions, nextCursor: null }),
    ),
  );
  return {
    setCurrent: (value: AgentConfig) => {
      current = value;
    },
    versions,
  };
}
function show() {
  return renderPage(<PostAgentsPage />, {
    path: "/post-generation-agents/post_plan",
    routes: ["/post-generation-agents/:stage"],
  });
}
beforeEach(() => sessionStorage.clear());
describe("post agent management", () => {
  it("shows an empty required prompt instead of code defaults when unconfigured", async () => {
    const state = fixture();
    state.setCurrent({
      ...config("post_plan", 0),
      id: null,
      aiModelId: null,
      provider: null,
      effectiveModel: null,
      systemPrompt: null,
    });
    show();
    expect(
      await screen.findByRole("textbox", { name: "시스템 지침" }),
    ).toHaveValue("");
    expect(screen.getByText("미설정")).toBeInTheDocument();
    expect(screen.getByText(/저장된 지침이 없습니다/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "코드 기본값 적용" }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "저장하고 적용" }),
    );
    expect(
      await screen.findByText("시스템 지침을 입력하세요."),
    ).toBeInTheDocument();
  });
  it("preserves input after conflict, allows review/rebase, and sends the reference plus nullable override", async () => {
    const state = fixture();
    const bodies: AgentInput[] = [];
    server.use(
      http.post(`${endpoint}/post_plan/versions`, async ({ request }) => {
        const body = (await request.json()) as AgentInput;
        bodies.push(body);
        if (bodies.length === 1) {
          state.setCurrent(config("post_plan", 2));
          return HttpResponse.json({ message: "설정 충돌" }, { status: 409 });
        }
        return HttpResponse.json({
          ...config("post_plan", 3),
          ...body,
          revision: 3,
        });
      }),
    );
    show();
    const prompt = await screen.findByRole("textbox", { name: "시스템 지침" });
    await userEvent.clear(prompt);
    await userEvent.type(prompt, "New instruction");
    await userEvent.click(
      screen.getByRole("button", { name: "저장하고 적용" }),
    );
    await screen.findByText("설정 충돌");
    expect(prompt).toHaveValue("New instruction");
    await userEvent.click(
      screen.getByRole("button", { name: "최신 설정 확인" }),
    );
    await screen.findByRole("button", { name: "서버의 최신 설정 보기" });
    await userEvent.click(
      screen.getByRole("button", {
        name: "입력 유지하고 최신 버전 기준으로 편집",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "저장하고 적용" }),
    );
    await screen.findByText("적용했습니다.");
    expect(bodies[1]).toEqual({
      expectedRevision: 2,
      aiModelId: "1",
      model: null,
      systemPrompt: "New instruction",
      outputSchema: schema,
    });
    expect(
      sessionStorage.getItem("opod:post-agent-draft:post_plan"),
    ).toBeNull();
  });
  it("guards stage navigation, restores the draft, and keeps generation free of LLM fields", async () => {
    fixture();
    show();
    const prompt = await screen.findByRole("textbox", { name: "시스템 지침" });
    await userEvent.type(prompt, " draft");
    await userEvent.click(screen.getByRole("button", { name: /이미지 생성/ }));
    await screen.findByRole("dialog", { name: "수정 중인 설정이 있습니다" });
    await userEvent.click(screen.getByRole("button", { name: "계속 편집" }));
    expect(prompt).toHaveValue("Instruction 1 draft");
    await userEvent.click(screen.getByRole("button", { name: /이미지 생성/ }));
    await userEvent.click(screen.getByRole("button", { name: "이동" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "시스템 지침" })).toBeNull(),
    );
    expect(
      await screen.findByLabelText("기본 모델", {
        exact: true,
        selector: "input",
      }),
    ).toHaveValue("openai / gpt-image-2.5-sunburst");
    await userEvent.click(screen.getByRole("button", { name: /게시물 기획/ }));
    expect(
      await screen.findByRole("textbox", { name: "시스템 지침" }),
    ).toHaveValue("Instruction 1 draft");
    await userEvent.click(screen.getByRole("button", { name: /캡션/ }));
    await screen.findByRole("dialog", { name: "수정 중인 설정이 있습니다" });
  });
  it("only restores after confirmation and retains the modal on failure", async () => {
    fixture();
    let requests = 0;
    server.use(
      http.post(`${endpoint}/post_plan/versions/1/restore`, () => {
        requests++;
        if (requests === 1)
          return HttpResponse.json({ message: "복원 오류" }, { status: 500 });
        return HttpResponse.json(config("post_plan", 2));
      }),
    );
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "버전 1 보기" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "이 버전 복원" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "이전 버전 적용",
    });
    expect(requests).toBe(0);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "확인하고 적용" }),
    );
    await within(dialog).findByText("복원 오류");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "확인하고 적용" }),
    );
    await screen.findByText("적용했습니다.");
    expect(requests).toBe(2);
  });
  it("registers a provider/model catalog entry without extra name fields", async () => {
    fixture();
    let body: unknown;
    server.use(
      http.post(`${endpoint}/models`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...models[0], model: "another-model" });
      }),
    );
    show();
    await userEvent.click(screen.getByRole("button", { name: "모델 관리" }));
    const dialog = await screen.findByRole("dialog", { name: "모델 관리" });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "모델명" }),
      "another-model",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "모델 등록" }),
    );
    await within(dialog).findByText("등록했습니다.");
    expect(body).toEqual({
      type: "llm",
      provider: "openai-compatible",
      model: "another-model",
    });
  });
});
