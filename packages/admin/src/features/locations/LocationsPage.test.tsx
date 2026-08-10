import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { LocationManagerPage } from "./LocationManagerPage";
import { LocationsPage } from "./LocationsPage";

const characters = [
  {
    id: "character-1",
    publicId: "seorin",
    displayName: "서린",
    bio: "",
    interests: [],
    status: "active",
    postCount: 0,
    followerCount: 0,
    createdAt: "2026-08-03T00:00:00.000Z",
  },
];

const location = {
  id: "location-1",
  characterId: "character-1",
  character: { id: "character-1", displayName: "서린", publicId: "seorin" },
  locationKey: "seorin-signature-gym",
  displayName: "서린이 다니는 헬스장",
  description: "서린의 바디라인 관리와 촬영을 위한 헬스장",
  visualPrompt: "modern gym",
  negativePrompt: "empty warehouse",
  referenceCount: 2,
  references: [
    {
      mediaId: "media-1",
      url: "https://media.example/one.jpg",
      width: 1024,
      height: 1024,
      uploadedAt: "2026-08-03T00:00:00.000Z",
      sortOrder: 10,
      description: "입구에서 본 전경",
    },
    {
      mediaId: "media-2",
      url: "https://media.example/two.jpg",
      width: 1024,
      height: 1024,
      uploadedAt: "2026-08-03T00:00:00.000Z",
      sortOrder: 20,
      description: "웨이트 존",
    },
  ],
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

function renderRoutes(initialEntry = "/locations") {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="locations" element={<LocationsPage />} />
          <Route
            path="locations/:locationId"
            element={<LocationManagerPage />}
          />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("location management", () => {
  it("filters locations by the selected character", async () => {
    const queries: string[] = [];
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: characters }),
      ),
      http.get("/api/admin/v1/locations", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [location] });
      }),
    );
    renderRoutes();

    await screen.findByText("서린이 다니는 헬스장");
    await userEvent.click(
      screen.getByRole("combobox", { name: "캐릭터 필터" }),
    );
    await userEvent.click(await screen.findByText("서린 (@seorin)"));

    await waitFor(() =>
      expect(
        queries.some((query) => query.includes("characterId=character-1")),
      ).toBe(true),
    );
  });

  it("reorders, edits, and unlinks references before saving", async () => {
    const referenceUpdates: unknown[] = [];
    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: characters }),
      ),
      http.get("/api/admin/v1/locations/:id", () =>
        HttpResponse.json(location),
      ),
      http.put(
        "/api/admin/v1/locations/:id/references",
        async ({ request }) => {
          const body = await request.json();
          referenceUpdates.push(body);
          return HttpResponse.json({ ...location, references: [] });
        },
      ),
    );
    renderRoutes("/locations/location-1");

    await screen.findByRole("heading", { name: "서린이 다니는 헬스장" });
    await userEvent.click(screen.getAllByRole("button", { name: "위로" })[1]);
    const description = screen.getByLabelText("이미지 1 설명");
    await userEvent.clear(description);
    await userEvent.type(description, "수정된 웨이트 존");
    await userEvent.click(
      screen.getAllByRole("button", { name: "연결 해제" })[1],
    );
    await userEvent.click(
      screen.getByRole("button", { name: "레퍼런스 저장" }),
    );

    await waitFor(() =>
      expect(referenceUpdates).toEqual([
        {
          references: [{ mediaId: "media-2", description: "수정된 웨이트 존" }],
        },
      ]),
    );
  });
});
