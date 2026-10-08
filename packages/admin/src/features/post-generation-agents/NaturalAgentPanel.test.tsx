import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { NaturalAgentPanel } from "./NaturalAgentPanel";
import type { NaturalConfig } from "./api";

beforeEach(() => sessionStorage.clear());
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
      onDirtyChange={dirty}
    />,
  );
  await user.click(
    screen.getByRole("button", {
      name: "새 Agent · 자연스러운 사진 자동 제작",
    }),
  );
  await screen.findByText("저장된 새 Agent 설정이 있습니다.", { exact: false });
  await user.click(screen.getByRole("button", { name: /^게시물 기획$/ }));
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
