import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { uploadMediaFile } from "./api";

describe("direct media upload", () => {
  it("presigns, uploads the file, and confirms it in order", async () => {
    const steps: string[] = [];

    server.use(
      http.post("/api/admin/v1/media/uploads", async ({ request }) => {
        steps.push("presign");
        expect(await request.json()).toEqual({
          mediaType: "image",
          contentType: "image/png",
          fileName: "profile.png",
          byteSize: 5,
          storagePrefix: "pod/profile/character/character-1",
        });
        return HttpResponse.json({
          media: {
            id: "media-1",
            mediaType: "image",
            url: "https://media.test/profile.png",
            uploadedAt: null,
            createdAt: "2026-07-31T00:00:00.000Z",
          },
          uploadUrl: "https://upload.test/profile.png",
          method: "PUT",
          headers: { "x-upload-token": "ticket-1" },
          expiresAt: "2026-07-31T01:00:00.000Z",
        });
      }),
      http.put("https://upload.test/profile.png", ({ request }) => {
        steps.push("upload");
        expect(request.headers.get("x-upload-token")).toBe("ticket-1");
        expect(request.headers.get("x-opod-admin")).toBeNull();
        return new HttpResponse(null, { status: 200 });
      }),
      http.post("/api/admin/v1/media/media-1/confirm-upload", ({ request }) => {
        steps.push("confirm");
        expect(request.headers.get("x-opod-admin")).toBe("1");
        return HttpResponse.json({
          id: "media-1",
          mediaType: "image",
          url: "https://media.test/profile.png",
          uploadedAt: "2026-07-31T00:01:00.000Z",
          createdAt: "2026-07-31T00:00:00.000Z",
        });
      }),
    );

    const result = await uploadMediaFile(
      new File(["image"], "profile.png", { type: "image/png" }),
      "image",
      "pod/profile/character/character-1",
    );

    expect(steps).toEqual(["presign", "upload", "confirm"]);
    expect(result.uploadedAt).toBe("2026-07-31T00:01:00.000Z");
  });
});
