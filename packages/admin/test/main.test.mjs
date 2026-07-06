import assert from "node:assert/strict";
import test from "node:test";
import {
  characterCreatePayload,
  characterDetailRequests,
  characterStatusPayload,
  characterUpdatePayload,
  adminRequestOptions,
  creditGrantPayload,
  dashboardRequests,
  endpoint,
  formActionRequest,
  generationActionBody,
  generationCreatePayload,
  generationActionRequest,
  itemsFromPage,
  memoryPayload,
  navItems,
  paymentDetailRequest,
  postPayload,
  reportUpdatePayload,
  selectedOption,
  userDetailRequests,
} from "../main.js";

test("postPayload uploads selected media before creating the post", async () => {
  const form = new FormData();
  form.set("actorId", " character-1 ");
  form.set("content", " hello ");
  form.set("reason", " daily post ");
  form.set("mediaType", " image ");
  form.set(
    "mediaFile",
    new File(["image-bytes"], "photo.png", { type: "image/png" }),
  );

  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/media/uploads") {
      return {
        ok: true,
        body: {
          media: { id: "media-1" },
          uploadUrl: "https://bucket.s3.us-east-1.amazonaws.com/media-1.png",
          method: "PUT",
          headers: { "content-type": "image/png" },
        },
      };
    }
    if (path === "/api/media/media-1/confirm-upload") {
      return { ok: true, body: { id: "media-1" } };
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const putObject = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const payload = await postPayload(form, request, putObject);

  assert.deepEqual(payload, {
    actorType: "character",
    actorId: "character-1",
    content: "hello",
    reason: "daily post",
    media: [{ mediaId: "media-1" }],
  });
  assert.equal(calls[0].path, "/api/media/uploads");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mediaType: "image",
    contentType: "image/png",
    fileName: "photo.png",
    byteSize: 11,
  });
  assert.equal(
    calls[1].url,
    "https://bucket.s3.us-east-1.amazonaws.com/media-1.png",
  );
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[2].path, "/api/media/media-1/confirm-upload");
});

test("postPayload rejects blank post content", async () => {
  const form = new FormData();
  form.set("actorId", "character-1");
  form.set("content", " ");
  form.set("reason", "daily post");
  form.set("mediaType", "image");
  form.set("mediaUrl", "https://cdn.example/image.png");

  await assert.rejects(() => postPayload(form), /content is required/);
});

test("navItems exposes the sidebar tabs in order", () => {
  assert.deepEqual(
    navItems.map((item) => item.id),
    [
      "dashboard",
      "users",
      "characters",
      "media",
      "generation",
      "moderation",
      "payments",
      "analytics",
      "settings",
    ],
  );
});

test("endpoint appends defined query params only", () => {
  assert.equal(
    endpoint("/api/users", { q: "mina", cursor: "", limit: 25 }),
    "/api/users?q=mina&limit=25",
  );
});

test("dashboardRequests uses existing admin endpoints", () => {
  assert.deepEqual(dashboardRequests(), [
    { key: "analytics", path: "/api/analytics" },
    { key: "logs", path: "/api/character-action-logs" },
    {
      key: "reports",
      path: "/api/moderation/reports?status=submitted&limit=10",
    },
    {
      key: "payments",
      path: "/api/payments/reconciliation?status=mismatch",
    },
  ]);
});

test("userDetailRequests targets the selected user", () => {
  assert.deepEqual(userDetailRequests("user-1"), [
    { key: "user", path: "/api/users/user-1" },
    { key: "events", path: "/api/events?userId=user-1&limit=20" },
    { key: "hashtags", path: "/api/hashtag-preferences?userId=user-1" },
    { key: "credits", path: "/api/credits/ledger?userId=user-1&limit=20" },
  ]);
});

test("itemsFromPage accepts page objects and arrays", () => {
  assert.deepEqual(itemsFromPage({ items: [{ id: "one" }] }), [{ id: "one" }]);
  assert.deepEqual(itemsFromPage([{ id: "two" }]), [{ id: "two" }]);
  assert.deepEqual(itemsFromPage(null), []);
});

test("characterDetailRequests fetches memory and logs for selected character", () => {
  assert.deepEqual(characterDetailRequests("char-1"), [
    { key: "memory", path: "/api/characters/char-1/memory" },
    { key: "logs", path: "/api/character-action-logs" },
  ]);
});

test("characterCreatePayload builds character create body", () => {
  const form = new FormData();
  form.set("publicId", "mina_ai");
  form.set("displayName", "Mina");
  form.set("bio", "City walks");
  form.set("interests", "art, travel");

  assert.deepEqual(characterCreatePayload(form), {
    publicId: "mina_ai",
    displayName: "Mina",
    bio: "City walks",
    interests: ["art", "travel"],
  });
});

test("memoryPayload trims content and reason", () => {
  const form = new FormData();
  form.set("content", " city night ");
  form.set("reason", " operator note ");

  assert.deepEqual(memoryPayload(form), {
    content: "city night",
    reason: "operator note",
  });
});

test("generationActionRequest builds existing job action endpoints", () => {
  assert.deepEqual(
    generationActionRequest("job-1", "retry", { reason: "bad" }),
    {
      path: "/api/generation/jobs/job-1/retry",
      options: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "bad" }),
      },
    },
  );
});

test("paymentDetailRequest targets payment detail endpoint", () => {
  assert.equal(paymentDetailRequest("pay-1"), "/api/payments/pay-1");
});

test("adminRequestOptions adds the admin API key header", () => {
  assert.deepEqual(adminRequestOptions({ method: "POST" }, " secret "), {
    method: "POST",
    headers: { "x-admin-api-key": "secret" },
  });
});

test("characterUpdatePayload trims editable fields", () => {
  const form = new FormData();
  form.set("displayName", " Mina ");
  form.set("bio", " City walks ");
  form.set("interests", " art, travel ,, ");

  assert.deepEqual(characterUpdatePayload(form), {
    displayName: "Mina",
    bio: "City walks",
    interests: ["art", "travel"],
  });
});

test("characterStatusPayload trims status and reason fields", () => {
  const form = new FormData();
  form.set("status", " inactive ");
  form.set("reason", " policy review ");

  assert.deepEqual(characterStatusPayload(form), {
    status: "inactive",
    reason: "policy review",
  });
});

test("reportUpdatePayload trims resolution", () => {
  const form = new FormData();
  form.set("status", " resolved ");
  form.set("resolution", " handled by operator ");

  assert.deepEqual(reportUpdatePayload(form), {
    status: "resolved",
    resolution: "handled by operator",
  });
});

test("selectedOption marks only the current value", () => {
  assert.equal(selectedOption("inactive", "inactive"), " selected");
  assert.equal(selectedOption("active", "inactive"), "");
});

test("creditGrantPayload trims fields and casts amount", () => {
  const form = new FormData();
  form.set("userId", " user-1 ");
  form.set("amount", "25");
  form.set("reason", " campaign ");

  assert.deepEqual(creditGrantPayload(form), {
    userId: "user-1",
    amount: 25,
    reason: "campaign",
  });
});

test("generationCreatePayload trims queue fields", () => {
  const form = new FormData();
  form.set("characterId", " char-1 ");
  form.set("mediaType", " image ");
  form.set("prompt", " city portrait ");

  assert.deepEqual(generationCreatePayload(form), {
    characterId: "char-1",
    mediaType: "image",
    prompt: "city portrait",
  });
});

test("generationActionBody builds action-specific bodies", () => {
  const form = new FormData();
  form.set("provider", " local ");
  form.set("reason", " timeout ");
  form.set("mediaId", " media-1 ");
  form.set("url", " https://cdn.example/media.png ");

  assert.deepEqual(generationActionBody("start", form), {});
  assert.deepEqual(generationActionBody("run", form), {
    provider: "local",
  });
  assert.deepEqual(generationActionBody("retry", form), {
    reason: "timeout",
  });
  assert.deepEqual(generationActionBody("complete", form), {
    mediaId: "media-1",
  });

  form.set("mediaId", " ");
  assert.deepEqual(generationActionBody("complete", form), {
    url: "https://cdn.example/media.png",
  });
});

test("generationActionBody omits empty optional fields", () => {
  const form = new FormData();
  form.set("provider", " ");
  form.set("reason", " ");

  assert.deepEqual(generationActionBody("run", form), {});
  assert.deepEqual(generationActionBody("retry", form), {});
  assert.deepEqual(generationActionBody("complete", form), {});
});

test("generationActionBody omits unsupported providers", () => {
  const form = new FormData();
  form.set("provider", "replicate");

  assert.deepEqual(generationActionBody("run", form), {});
});

test("formActionRequest maps form actions to existing endpoints", async () => {
  const cases = [
    {
      action: "character-create",
      data: {
        publicId: "mina_ai",
        displayName: "Mina",
        bio: "City walks",
        interests: "art, travel",
      },
      path: "/api/characters",
      method: "POST",
      body: {
        publicId: "mina_ai",
        displayName: "Mina",
        bio: "City walks",
        interests: ["art", "travel"],
      },
    },
    {
      action: "character-update",
      dataset: { characterId: "char-1" },
      data: { displayName: "Mina", bio: "City walks", interests: "art" },
      path: "/api/characters/char-1",
      method: "PATCH",
      body: { displayName: "Mina", bio: "City walks", interests: ["art"] },
    },
    {
      action: "character-status",
      dataset: { characterId: "char-1" },
      data: { status: "inactive", reason: "policy" },
      path: "/api/characters/char-1/status",
      method: "PATCH",
      body: { status: "inactive", reason: "policy" },
    },
    {
      action: "memory-create",
      dataset: { characterId: "char-1" },
      data: { content: "city night", reason: "operator" },
      path: "/api/characters/char-1/memory",
      method: "POST",
      body: { content: "city night", reason: "operator" },
    },
    {
      action: "credit-grant",
      data: { userId: "user-1", amount: "10", reason: "campaign" },
      path: "/api/credits/grants",
      method: "POST",
      body: { userId: "user-1", amount: 10, reason: "campaign" },
    },
    {
      action: "post-create",
      data: {
        actorId: " char-1 ",
        content: " hello ",
        reason: " daily ",
        mediaType: " image ",
        mediaUrl: " https://cdn.example/image.png ",
      },
      path: "/api/posts",
      method: "POST",
      body: {
        actorType: "character",
        actorId: "char-1",
        content: "hello",
        reason: "daily",
        media: [{ mediaType: "image", url: "https://cdn.example/image.png" }],
      },
    },
    {
      action: "generation-create",
      data: {
        characterId: "char-1",
        mediaType: "image",
        prompt: "city portrait",
      },
      path: "/api/generation/jobs",
      method: "POST",
      body: {
        characterId: "char-1",
        mediaType: "image",
        prompt: "city portrait",
      },
    },
    {
      action: "report-update",
      data: { reportId: "report-1", status: "resolved", resolution: "ok" },
      path: "/api/moderation/reports/report-1",
      method: "PATCH",
      body: { status: "resolved", resolution: "ok" },
    },
  ];

  for (const item of cases) {
    const form = new FormData();
    for (const [key, value] of Object.entries(item.data)) {
      form.set(key, value);
    }

    const request = await formActionRequest(
      item.action,
      form,
      item.dataset ?? {},
    );

    assert.equal(request.path, item.path);
    assert.equal(request.options.method, item.method);
    assert.deepEqual(JSON.parse(request.options.body), item.body);
  }
});

test("formActionRequest maps generation job actions", async () => {
  const form = new FormData();
  form.set("jobId", "job-1");
  form.set("action", "complete");
  form.set("mediaId", "media-1");
  form.set("url", "https://cdn.example/image.png");

  const request = await formActionRequest("generation-action", form);

  assert.deepEqual(request, {
    path: "/api/generation/jobs/job-1/complete",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaId: "media-1" }),
    },
  });
});
