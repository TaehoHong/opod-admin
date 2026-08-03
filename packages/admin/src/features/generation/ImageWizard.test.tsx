import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { ImageWizard } from "./ImageWizard";
import type { GenerationJob } from "./api";

if (!document.fonts) {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function imageJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: JOB_ID,
    characterId: "22222222-2222-4222-8222-222222222222",
    mediaType: "image",
    prompt: "초기 프롬프트",
    inputPrompt: "원본 요청",
    candidateCount: 3,
    status: "draft",
    attemptCount: 0,
    createdAt: "2026-07-31T01:00:00.000Z",
    updatedAt: "2026-07-31T01:00:00.000Z",
    ...overrides,
  };
}

describe("image generation wizard", () => {
  it("saves the current prompt and count before confirming generation", async () => {
    const events: string[] = [];
    const patchBodies: unknown[] = [];

    server.use(
      http.get(`/api/admin/v1/generation/jobs/${JOB_ID}`, () =>
        HttpResponse.json(imageJob()),
      ),
      http.patch(
        `/api/admin/v1/generation/jobs/${JOB_ID}/draft`,
        async ({ request }) => {
          events.push("patch");
          const body = await request.json();
          patchBodies.push(body);
          return HttpResponse.json(imageJob(body as Partial<GenerationJob>));
        },
      ),
      http.post(`/api/admin/v1/generation/jobs/${JOB_ID}/confirm`, () => {
        events.push("confirm");
        return HttpResponse.json(imageJob({ status: "queued" }));
      }),
    );

    render(
      <AppProviders>
        <ImageWizard jobId={JOB_ID} onJobChange={() => {}} />
      </AppProviders>,
    );

    const prompt = await screen.findByRole("textbox", {
      name: "최종 프롬프트",
    });
    await userEvent.clear(prompt);
    await userEvent.type(prompt, "  수정한 프롬프트  ");
    await userEvent.click(screen.getByRole("button", { name: "이미지 생성" }));

    await waitFor(() => expect(events).toEqual(["patch", "confirm"]));
    expect(patchBodies).toEqual([
      { prompt: "수정한 프롬프트", candidateCount: 3 },
    ]);
  });

  it("does not confirm generation when saving the draft fails", async () => {
    let confirmRequests = 0;

    server.use(
      http.get(`/api/admin/v1/generation/jobs/${JOB_ID}`, () =>
        HttpResponse.json(imageJob()),
      ),
      http.patch(`/api/admin/v1/generation/jobs/${JOB_ID}/draft`, () =>
        HttpResponse.json(
          { message: "프롬프트를 저장할 수 없습니다." },
          { status: 400 },
        ),
      ),
      http.post(`/api/admin/v1/generation/jobs/${JOB_ID}/confirm`, () => {
        confirmRequests += 1;
        return HttpResponse.json(imageJob({ status: "queued" }));
      }),
    );

    render(
      <AppProviders>
        <ImageWizard jobId={JOB_ID} onJobChange={() => {}} />
      </AppProviders>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "이미지 생성" }),
    );

    expect(
      await screen.findByText("프롬프트를 저장할 수 없습니다."),
    ).toBeInTheDocument();
    expect(confirmRequests).toBe(0);
  });

  it("keeps a candidate selection local until final confirmation", async () => {
    const selectBodies: unknown[] = [];
    const completed = imageJob({
      status: "completed",
      outputs: [
        {
          mediaId: "33333333-3333-4333-8333-333333333333",
          url: "https://cdn.example.com/first.png",
          candidateIndex: 0,
          selected: false,
        },
        {
          mediaId: "44444444-4444-4444-8444-444444444444",
          url: "https://cdn.example.com/second.png",
          candidateIndex: 1,
          selected: false,
        },
      ],
    });

    server.use(
      http.get(`/api/admin/v1/generation/jobs/${JOB_ID}`, () =>
        HttpResponse.json(completed),
      ),
      http.post(
        `/api/admin/v1/generation/jobs/${JOB_ID}/select-output`,
        async ({ request }) => {
          const body = await request.json();
          selectBodies.push(body);
          return HttpResponse.json({
            ...completed,
            outputMediaId: (body as { mediaId: string }).mediaId,
          });
        },
      ),
    );

    render(
      <AppProviders>
        <ImageWizard jobId={JOB_ID} onJobChange={() => {}} />
      </AppProviders>,
    );

    const secondCandidate = await screen.findByRole("button", {
      name: "후보 2 선택",
    });
    await userEvent.click(secondCandidate);
    expect(secondCandidate).toHaveAttribute("aria-pressed", "true");
    expect(selectBodies).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "최종 확정" }));

    await waitFor(() =>
      expect(selectBodies).toEqual([
        { mediaId: "44444444-4444-4444-8444-444444444444" },
      ]),
    );
  });
});
