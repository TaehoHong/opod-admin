import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { CharacterManagerPage } from "./CharacterManagerPage";
import { CharactersPage } from "./CharactersPage";
import type { CharacterCreate } from "./api";

function renderCharacterRoutes() {
  server.use(
    http.get("/api/admin/v1/media", () => HttpResponse.json({ items: [] })),
  );
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/characters"]}>
        <Routes>
          <Route path="characters" element={<CharactersPage />} />
          <Route
            path="characters/:characterId"
            element={<CharacterManagerPage />}
          />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("character management", () => {
  it("creates a character and opens its management page", async () => {
    const requests: unknown[] = [];
    let items: Array<Record<string, unknown>> = [];

    server.use(
      http.get("/api/admin/v1/characters", () => HttpResponse.json({ items })),
      http.post("/api/admin/v1/characters", async ({ request }) => {
        const body = (await request.json()) as CharacterCreate;
        requests.push(body);
        const created = {
          id: "character-2",
          ...body,
          status: "active",
          postCount: 0,
          followerCount: 0,
          createdAt: "2026-07-31T01:00:00.000Z",
        };
        items = [created, ...items];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get("/api/admin/v1/characters/:id", ({ params }) =>
        HttpResponse.json({
          ...items.find((item) => item.id === params.id),
          personas: [],
          memories: [],
        }),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: "character-2",
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
    );

    renderCharacterRoutes();

    await screen.findByText("표시할 항목이 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "캐릭터 추가" }));
    await userEvent.type(
      await screen.findByLabelText("핸들"),
      "  new-character  ",
    );
    await userEvent.type(screen.getByLabelText("표시 이름"), "  새 캐릭터  ");
    await userEvent.type(screen.getByLabelText("소개"), "  새 소개  ");
    await userEvent.type(
      screen.getByRole("combobox", { name: "관심사" }),
      "photography, travel",
    );
    await userEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() =>
      expect(requests).toEqual([
        {
          publicId: "new-character",
          displayName: "새 캐릭터",
          bio: "새 소개",
          interests: ["photography", "travel"],
        },
      ]),
    );
    expect(
      await screen.findByRole("link", { name: "목록으로" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "새 캐릭터" }),
    ).toBeInTheDocument();
  }, 10_000);

  it("updates the profile and adds a persona from the character manager", async () => {
    const profileUpdates: unknown[] = [];
    const personaCreates: unknown[] = [];
    const character = {
      id: "character-1",
      publicId: "existing",
      displayName: "기존 캐릭터",
      bio: "기존 소개",
      interests: ["music"],
      status: "active",
      postCount: 0,
      followerCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      personas: [],
      memories: [],
    };

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/characters/:id", () =>
        HttpResponse.json(character),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: character.id,
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
      http.patch("/api/admin/v1/characters/:id", async ({ request }) => {
        const body = await request.json();
        profileUpdates.push(body);
        Object.assign(character, body);
        return HttpResponse.json(character);
      }),
      http.post(
        "/api/admin/v1/characters/:id/personas",
        async ({ request }) => {
          const body = await request.json();
          personaCreates.push(body);
          const persona = {
            id: "persona-1",
            characterId: character.id,
            ...(body as object),
            sortOrder: 10,
            createdAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:00.000Z",
          };
          character.personas.push(persona as never);
          return HttpResponse.json(persona, { status: 201 });
        },
      ),
    );

    renderCharacterRoutes();

    await screen.findByText("기존 캐릭터");
    expect(
      screen.queryByRole("button", { name: "관리" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("기존 캐릭터 관리"));

    const displayName = await screen.findByLabelText("표시 이름");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.clear(displayName);
    await userEvent.type(displayName, "수정 캐릭터");
    await userEvent.click(screen.getByRole("button", { name: "프로필 저장" }));

    await waitFor(() =>
      expect(profileUpdates).toEqual([
        {
          displayName: "수정 캐릭터",
          bio: "기존 소개",
          interests: ["music"],
        },
      ]),
    );

    await userEvent.click(screen.getByRole("tab", { name: "페르소나" }));
    await userEvent.type(screen.getByLabelText("새 페르소나 제목"), "말투");
    await userEvent.type(
      screen.getByLabelText("새 페르소나 내용"),
      "짧고 친근하게 말한다.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "페르소나 추가" }),
    );

    await waitFor(() =>
      expect(personaCreates).toEqual([
        { title: "말투", content: "짧고 친근하게 말한다." },
      ]),
    );
    expect(await screen.findByDisplayValue("말투")).toBeInTheDocument();
  });

  it("fills the persona title from a standard block preset", async () => {
    const personaCreates: unknown[] = [];
    const character = {
      id: "character-1",
      publicId: "existing",
      displayName: "기존 캐릭터",
      bio: "기존 소개",
      interests: ["music"],
      status: "active",
      postCount: 0,
      followerCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      personas: [],
      memories: [],
    };

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/characters/:id", () =>
        HttpResponse.json(character),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: character.id,
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
      http.post(
        "/api/admin/v1/characters/:id/personas",
        async ({ request }) => {
          const body = await request.json();
          personaCreates.push(body);
          return HttpResponse.json(
            { id: "persona-1", characterId: character.id, ...(body as object) },
            { status: 201 },
          );
        },
      ),
    );

    renderCharacterRoutes();

    await screen.findByText("기존 캐릭터");
    await userEvent.click(screen.getByText("기존 캐릭터"));
    await screen.findByLabelText("표시 이름");
    await userEvent.click(screen.getByRole("tab", { name: "페르소나" }));

    // 첫인사는 React 이관 전까지 admin에서 만들 수 없던 표준 블록이다.
    await userEvent.click(
      await screen.findByRole("combobox", { name: "제목 타입" }),
    );
    await userEvent.click(await screen.findByText("첫인사 (greeting)"));

    expect(screen.getByLabelText("새 페르소나 제목")).toHaveValue("greeting");

    await userEvent.type(
      screen.getByLabelText("새 페르소나 내용"),
      "오랜만이야, 잘 지냈어?",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "페르소나 추가" }),
    );

    await waitFor(() =>
      expect(personaCreates).toEqual([
        { title: "greeting", content: "오랜만이야, 잘 지냈어?" },
      ]),
    );
  });

  it("saves memory, visual prompts, and posting policy from their tabs", async () => {
    const memoryCreates: unknown[] = [];
    const visualUpdates: unknown[] = [];
    const policyUpdates: unknown[] = [];
    const character = {
      id: "character-1",
      publicId: "existing",
      displayName: "기존 캐릭터",
      bio: "기존 소개",
      interests: ["music"],
      status: "active",
      postCount: 0,
      followerCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      personas: [],
      memories: [],
    };

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/characters/:id", () =>
        HttpResponse.json(character),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: character.id,
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
      http.get("/api/admin/v1/media", () => HttpResponse.json({ items: [] })),
      http.get("/api/admin/v1/characters/:id/visual-profile", () =>
        HttpResponse.json({
          characterId: character.id,
          appearancePrompt: "",
          stylePrompt: "",
          negativePrompt: "",
          referenceMedia: [],
        }),
      ),
      http.get("/api/admin/v1/generation/jobs", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get("/api/admin/v1/drafts", () => HttpResponse.json({ items: [] })),
      http.get("/api/admin/v1/characters/:id/posting-policy", () =>
        HttpResponse.json({
          characterId: character.id,
          enabled: false,
          weeklyCadence: 3,
          hourStartKst: 18,
          hourEndKst: 22,
        }),
      ),
      http.post("/api/admin/v1/characters/:id/memory", async ({ request }) => {
        const body = await request.json();
        memoryCreates.push(body);
        return HttpResponse.json({ id: "memory-1", ...(body as object) });
      }),
      http.put(
        "/api/admin/v1/characters/:id/visual-profile",
        async ({ request }) => {
          const body = await request.json();
          visualUpdates.push(body);
          return HttpResponse.json({
            characterId: character.id,
            ...(body as object),
            referenceMedia: [],
          });
        },
      ),
      http.put(
        "/api/admin/v1/characters/:id/posting-policy",
        async ({ request }) => {
          const body = await request.json();
          policyUpdates.push(body);
          return HttpResponse.json({
            characterId: character.id,
            ...(body as object),
          });
        },
      ),
    );

    renderCharacterRoutes();

    await screen.findByText("기존 캐릭터");
    await userEvent.click(screen.getByText("기존 캐릭터"));

    await userEvent.click(screen.getByRole("tab", { name: "메모리" }));
    await userEvent.type(
      await screen.findByLabelText("새 메모리 내용"),
      "  제주에 산다.  ",
    );
    await userEvent.type(
      screen.getByLabelText("등록 출처·사유"),
      "  초기 설정  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "메모리 추가" }));

    await userEvent.click(screen.getByRole("tab", { name: "비주얼" }));
    await userEvent.type(
      await screen.findByLabelText("외모 프롬프트"),
      "  shoulder-length hair  ",
    );
    await userEvent.type(
      screen.getByLabelText("스타일 프롬프트"),
      "  film photography  ",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "비주얼 프로필 저장" }),
    );

    await userEvent.click(screen.getByRole("tab", { name: "자동화" }));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "자동 포스팅 활성화" }),
    );
    const cadence = screen.getByLabelText("주당 게시 횟수");
    await userEvent.clear(cadence);
    await userEvent.type(cadence, "5");
    await userEvent.click(screen.getByRole("button", { name: "정책 저장" }));

    await waitFor(() => {
      expect(memoryCreates).toEqual([
        { content: "제주에 산다.", type: "fact", reason: "초기 설정" },
      ]);
      expect(visualUpdates).toEqual([
        {
          appearancePrompt: "shoulder-length hair",
          stylePrompt: "film photography",
          negativePrompt: "",
        },
      ]);
      expect(policyUpdates).toEqual([
        {
          enabled: true,
          weeklyCadence: 5,
          hourStartKst: 18,
          hourEndKst: 22,
        },
      ]);
    });
  }, 15_000);

  it("shows character-scoped posts and action logs in the manager", async () => {
    const character = {
      id: "character-1",
      publicId: "existing",
      displayName: "기존 캐릭터",
      bio: "기존 소개",
      interests: ["music"],
      status: "active",
      postCount: 1,
      followerCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      personas: [],
      memories: [],
    };
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/characters/:id", () =>
        HttpResponse.json(character),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: character.id,
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
      http.get("/api/admin/v1/posts", ({ request }) => {
        expect(new URL(request.url).searchParams.get("characterId")).toBe(
          character.id,
        );
        return HttpResponse.json({
          items: [
            {
              id: "post-1",
              characterId: character.id,
              contentType: "feed",
              content: "캐릭터 전용 게시글",
              media: [],
              hashtags: [],
              commentCount: 2,
              reactionCount: 3,
              createdAt: "2026-07-31T01:00:00.000Z",
            },
          ],
        });
      }),
      http.get("/api/admin/v1/character-action-logs", ({ request }) => {
        expect(new URL(request.url).searchParams.get("characterId")).toBe(
          character.id,
        );
        return HttpResponse.json({
          items: [
            {
              id: "log-1",
              characterId: character.id,
              actionType: "MEMORY_CREATED",
              targetTable: "character_memories",
              targetId: "memory-123456789",
              reason: "운영 메모리",
              createdAt: "2026-07-31T02:00:00.000Z",
            },
          ],
        });
      }),
    );

    renderCharacterRoutes();

    await screen.findByText("기존 캐릭터");
    await userEvent.click(screen.getByText("기존 캐릭터"));
    await userEvent.click(await screen.findByRole("tab", { name: "게시글" }));
    expect(await screen.findByText("캐릭터 전용 게시글")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "활동" }));
    expect(await screen.findByText("MEMORY_CREATED")).toBeInTheDocument();
    expect(screen.getByText("운영 메모리")).toBeInTheDocument();
    expect(
      screen.getByText(/character_memories · memory-1…/),
    ).toBeInTheDocument();
  });
});

describe("visual reference promotion", () => {
  // 테스트 생성 결과를 레퍼런스로 올려야 다음 생성에 반영된다. 이 경로가 없으면
  // 결과를 보러 생성 화면으로 나갔다가 미디어 ID를 손으로 옮겨야 한다.
  it("promotes a completed generation output into the visual references", async () => {
    const referenceUpdates: unknown[] = [];
    const character = {
      id: "character-1",
      publicId: "existing",
      displayName: "기존 캐릭터",
      bio: "",
      interests: [],
      status: "active",
      postCount: 0,
      followerCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      personas: [],
      memories: [],
    };

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/characters/:id", () =>
        HttpResponse.json(character),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: character.id,
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
      http.get("/api/admin/v1/media", () => HttpResponse.json({ items: [] })),
      http.get("/api/admin/v1/characters/:id/visual-profile", () =>
        HttpResponse.json({
          characterId: character.id,
          appearancePrompt: "",
          stylePrompt: "",
          negativePrompt: "",
          referenceMedia: [],
        }),
      ),
      http.get("/api/admin/v1/generation/jobs", () =>
        HttpResponse.json({
          items: [
            {
              id: "job-1",
              characterId: character.id,
              mediaType: "image",
              prompt: "해변 산책 테스트",
              status: "completed",
              attemptCount: 1,
              outputMediaId: "media-9",
              outputs: [
                {
                  mediaId: "media-9",
                  url: "https://cdn.local/test-output.png",
                  candidateIndex: 0,
                  selected: true,
                },
              ],
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.put(
        "/api/admin/v1/characters/:id/visual-profile/references",
        async ({ request }) => {
          referenceUpdates.push(await request.json());
          return HttpResponse.json({
            characterId: character.id,
            appearancePrompt: "",
            stylePrompt: "",
            negativePrompt: "",
            referenceMedia: [
              {
                mediaId: "media-9",
                url: "",
                sortOrder: 10,
                isActive: true,
                description: "",
              },
            ],
          });
        },
      ),
    );

    renderCharacterRoutes();

    await userEvent.click(await screen.findByLabelText("기존 캐릭터 관리"));
    await userEvent.click(await screen.findByRole("tab", { name: "비주얼" }));
    await userEvent.click(await screen.findByRole("button", { name: "승격" }));

    await waitFor(() =>
      expect(referenceUpdates).toEqual([{ mediaIds: ["media-9"] }]),
    );
  }, 15_000);

  it("keeps inactive references visible and reactivates them on save", async () => {
    const referenceUpdates: unknown[] = [];
    const character = {
      id: "character-1",
      publicId: "existing",
      displayName: "기존 캐릭터",
      bio: "",
      interests: [],
      status: "active",
      postCount: 0,
      followerCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      personas: [],
      memories: [],
    };
    let updatedAt = 0;
    const visualProfile = {
      characterId: character.id,
      appearancePrompt: "",
      stylePrompt: "",
      negativePrompt: "",
      referenceMedia: [
        {
          mediaId: "media-active",
          url: "https://cdn.local/active.png",
          sortOrder: 10,
          isActive: true,
          description: "active portrait",
        },
        {
          mediaId: "media-inactive",
          url: "https://cdn.local/inactive.png",
          sortOrder: 20,
          isActive: false,
          description: "inactive portrait",
        },
      ],
    };

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [character] }),
      ),
      http.get("/api/admin/v1/characters/:id", () =>
        HttpResponse.json(character),
      ),
      http.get("/api/admin/v1/characters/:id/profile-image", () =>
        HttpResponse.json({
          characterId: character.id,
          image: null,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        }),
      ),
      http.get("/api/admin/v1/media", () =>
        HttpResponse.json({
          items: visualProfile.referenceMedia.map((reference) => ({
            id: reference.mediaId,
            mediaType: "image",
            url: reference.url,
            uploadedAt: "2026-08-01T00:00:00.000Z",
            createdAt: "2026-08-01T00:00:00.000Z",
          })),
        }),
      ),
      http.get("/api/admin/v1/characters/:id/visual-profile", () =>
        HttpResponse.json(visualProfile),
      ),
      http.get("/api/admin/v1/generation/jobs", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.put(
        "/api/admin/v1/characters/:id/visual-profile/references",
        async ({ request }) => {
          const body = (await request.json()) as { mediaIds: string[] };
          referenceUpdates.push(body);
          for (const reference of visualProfile.referenceMedia) {
            reference.isActive = body.mediaIds.includes(reference.mediaId);
          }
          updatedAt += 1;
          return HttpResponse.json({
            ...visualProfile,
            updatedAt: `2026-08-01T00:00:0${updatedAt}.000Z`,
          });
        },
      ),
    );

    renderCharacterRoutes();

    await userEvent.click(await screen.findByLabelText("기존 캐릭터 관리"));
    await userEvent.click(await screen.findByRole("tab", { name: "비주얼" }));
    expect(await screen.findByText("inactive portrait")).toBeInTheDocument();
    expect(screen.getByText("비활성")).toBeInTheDocument();

    const activeSelect = screen.getByRole("combobox", {
      name: "활성 레퍼런스",
    });
    await userEvent.click(activeSelect);
    await userEvent.keyboard("{Backspace}");
    await userEvent.click(
      screen.getByRole("button", { name: "레퍼런스 저장" }),
    );

    await waitFor(() => expect(referenceUpdates).toEqual([{ mediaIds: [] }]));
    expect(screen.getAllByText("비활성")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "빈 캡션 생성" })).toBeDisabled();

    await userEvent.click(
      screen.getByRole("combobox", { name: "활성 레퍼런스" }),
    );
    await userEvent.click(
      await screen.findByText("media-inactive", {
        selector: '[role="option"] span',
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "레퍼런스 저장" }),
    );

    await waitFor(() =>
      expect(referenceUpdates).toEqual([
        { mediaIds: [] },
        { mediaIds: ["media-inactive"] },
      ]),
    );
    expect(screen.getByText("활성")).toBeInTheDocument();
  }, 15_000);
});
