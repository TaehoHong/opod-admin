import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { CharacterContentProfilePanel } from "./CharacterContentProfilePanel";

const endpoint = "/api/admin/v1/characters/:id/content-profile";
const empty = {
  accountConcept: "",
  imageStyle: "",
  captionStyle: "",
  constraints: "",
};

describe("content profile editor", () => {
  it("saves all four fields, can clear them, and preserves typed text after a failed save", async () => {
    let stored = { ...empty, accountConcept: "러닝" };
    let fail = true;
    server.use(
      http.get(endpoint, () => HttpResponse.json(stored)),
      http.put(endpoint, async ({ request }) => {
        if (fail)
          return HttpResponse.json({ message: "저장 오류" }, { status: 500 });
        stored = (await request.json()) as typeof stored;
        return HttpResponse.json(stored);
      }),
    );
    render(
      <AppProviders>
        <CharacterContentProfilePanel characterId="character-1" />
      </AppProviders>,
    );
    const concept = await screen.findByRole("textbox", { name: "계정 컨셉" });
    expect(concept).toHaveValue("러닝");
    await userEvent.clear(concept);
    await userEvent.type(
      screen.getByRole("textbox", { name: "사진 스타일" }),
      "자연스러운 사진",
    );
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장 오류");
    expect(screen.getByRole("textbox", { name: "사진 스타일" })).toHaveValue(
      "자연스러운 사진",
    );
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("status");
    expect(stored).toEqual({ ...empty, imageStyle: "자연스러운 사진" });
  });
});
