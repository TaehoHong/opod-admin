import assert from "node:assert/strict";
import test from "node:test";
import {
  adminUserStats,
  analyticsRequests,
  characterCreatePayload,
  characterDetailRequests,
  characterHref,
  characterRouteState,
  characterStatusPayload,
  characterUpdatePayload,
  adminAccountPayload,
  adminLoginPayload,
  adminRequestOptions,
  creditGrantPayload,
  currentRouteFromHash,
  dashboardRequests,
  dialogContextFromDataset,
  dialogBody,
  endpoint,
  formActionRequest,
  generationActionBody,
  generationClickRequest,
  generationCreatePayload,
  generationFormActionRequest,
  generationActionRequest,
  itemsFromPage,
  memoryBulkPayload,
  memoryPayload,
  navItems,
  parseResponseBody,
  paymentDetailRequest,
  personaBulkPayload,
  personaPayload,
  personaReorderPayload,
  postSelectionAfterAction,
  postPayload,
  reportUpdatePayload,
  selectedOption,
  storyPayload,
  userDetailRequests,
} from "../main.js";

test("postPayload uploads selected media before creating the post", async () => {
  const form = new FormData();
  form.set("actorId", " character-1 ");
  form.set("content", " hello ");
  form.set("reason", " daily post ");
  form.set("contentType", " reel ");
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
    contentType: "reel",
    media: [{ mediaId: "media-1" }],
  });
  assert.equal(calls[0].path, "/api/media/uploads");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mediaType: "image",
    contentType: "image/png",
    fileName: "photo.png",
    byteSize: 11,
    storagePrefix: "pod/reels/character/character-1",
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
  form.set("contentType", "feed");
  form.set("mediaType", "image");
  form.set("mediaUrl", "https://cdn.example/image.png");

  await assert.rejects(() => postPayload(form), /content is required/);
});

test("storyPayload uploads selected media under the story prefix", async () => {
  const form = new FormData();
  form.set("characterId", " character-1 ");
  form.set("caption", " hello story ");
  form.set("reason", " daily story ");
  form.set("mediaType", " image ");
  form.set(
    "mediaFile",
    new File(["image-bytes"], "story.png", { type: "image/png" }),
  );

  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/media/uploads") {
      return {
        ok: true,
        body: {
          media: { id: "media-story" },
          uploadUrl: "https://bucket.s3.us-east-1.amazonaws.com/story.png",
          method: "PUT",
          headers: { "content-type": "image/png" },
        },
      };
    }
    if (path === "/api/media/media-story/confirm-upload") {
      return { ok: true, body: { id: "media-story" } };
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const putObject = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const payload = await storyPayload(form, request, putObject);

  assert.deepEqual(payload, {
    characterId: "character-1",
    caption: "hello story",
    reason: "daily story",
    media: { mediaId: "media-story" },
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mediaType: "image",
    contentType: "image/png",
    fileName: "story.png",
    byteSize: 11,
    storagePrefix: "pod/stories/character/character-1",
  });
});

test("navItems exposes the sidebar tabs in order", () => {
  assert.deepEqual(
    navItems.map((item) => item.id),
    [
      "characters",
      "posts",
      "media",
      "generation",
      "users",
      "credits",
      "payments",
      "moderation",
      "events",
      "logs",
      "analytics",
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

test("analyticsRequests includes metrics and top hashtags", () => {
  assert.deepEqual(analyticsRequests(), [
    "/api/analytics",
    "/api/analytics/hashtags?limit=10",
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

test("adminUserStats uses authoritative user count and balance fields", () => {
  assert.deepEqual(adminUserStats({ followCount: 7, creditBalance: 108 }), {
    followCount: 7,
    creditBalance: 108,
  });
  assert.deepEqual(adminUserStats({}), {
    followCount: 0,
    creditBalance: 0,
  });
});

test("itemsFromPage accepts page objects and arrays", () => {
  assert.deepEqual(itemsFromPage({ items: [{ id: "one" }] }), [{ id: "one" }]);
  assert.deepEqual(itemsFromPage([{ id: "two" }]), [{ id: "two" }]);
  assert.deepEqual(itemsFromPage(null), []);
});

test("currentRouteFromHash sends anonymous admins to login", () => {
  assert.equal(currentRouteFromHash("#characters", ""), "login");
  assert.equal(currentRouteFromHash("#media", ""), "login");
  assert.equal(currentRouteFromHash("#login", ""), "login");
  assert.equal(currentRouteFromHash("#login", "token-1"), "characters");
  assert.equal(currentRouteFromHash("#unknown", "token-1"), "characters");
  assert.equal(
    currentRouteFromHash("#characters?mode=create", "token-1"),
    "characters",
  );
});

test("parseResponseBody preserves plain text backend errors", () => {
  assert.deepEqual(
    parseResponseBody("Internal server error", { status: 500 }),
    {
      error: "Internal server error",
      status: 500,
    },
  );
  assert.deepEqual(parseResponseBody("", { status: 204 }), { status: 204 });
});

test("characterDetailRequests fetches memory and logs for selected character", () => {
  assert.deepEqual(characterDetailRequests("char-1"), [
    { key: "character", path: "/api/characters/char-1" },
    { key: "personas", path: "/api/characters/char-1/personas" },
    { key: "memory", path: "/api/characters/char-1/memory" },
    { key: "logs", path: "/api/character-action-logs" },
  ]);
});

test("characterRouteState parses list, create, detail, and tab states", () => {
  assert.deepEqual(characterRouteState("#characters"), {
    route: "characters",
    mode: "list",
    characterId: "",
    tab: "profile",
  });
  assert.deepEqual(characterRouteState("#characters?mode=create"), {
    route: "characters",
    mode: "create",
    characterId: "",
    tab: "profile",
  });
  assert.deepEqual(
    characterRouteState("#characters?characterId=char-1&tab=activity"),
    {
      route: "characters",
      mode: "detail",
      characterId: "char-1",
      tab: "activity",
    },
  );
  // Unknown tabs fall back to the profile tab.
  assert.equal(
    characterRouteState("#characters?characterId=char-1&tab=memory").tab,
    "profile",
  );
});

test("characterHref builds character route hashes", () => {
  assert.equal(characterHref(), "#characters");
  assert.equal(characterHref({ mode: "create" }), "#characters?mode=create");
  assert.equal(
    characterHref({ characterId: "char-1", tab: "activity" }),
    "#characters?characterId=char-1&tab=activity",
  );
});

test("post selection actions open, close, and reset post detail", () => {
  assert.equal(
    postSelectionAfterAction("select-post", null, "post-1"),
    "post-1",
  );
  assert.equal(postSelectionAfterAction("back-posts", "post-1"), null);
  assert.equal(postSelectionAfterAction("sidebar-navigation", "post-1"), null);
  assert.equal(
    postSelectionAfterAction("unrelated", "post-1", "post-2"),
    "post-1",
  );
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

test("personaPayload trims title and content", () => {
  const form = new FormData();
  form.set("title", " Core ");
  form.set("content", " speaks warmly ");

  assert.deepEqual(personaPayload(form), {
    title: "Core",
    content: "speaks warmly",
  });
});

test("personaPayload includes sortOrder only when the field is filled", () => {
  const withOrder = new FormData();
  withOrder.set("title", "Core");
  withOrder.set("content", "warm");
  withOrder.set("sortOrder", "20");
  assert.deepEqual(personaPayload(withOrder), {
    title: "Core",
    content: "warm",
    sortOrder: 20,
  });

  const withoutOrder = new FormData();
  withoutOrder.set("title", "Core");
  withoutOrder.set("content", "warm");
  withoutOrder.set("sortOrder", "");
  assert.deepEqual(personaPayload(withoutOrder), {
    title: "Core",
    content: "warm",
  });
});

test("personaReorderPayload parses a JSON array of persona ids", () => {
  const form = new FormData();
  form.set("personaIds", '["p-2","p-1","p-3"]');
  assert.deepEqual(personaReorderPayload(form), {
    personaIds: ["p-2", "p-1", "p-3"],
  });

  const invalid = new FormData();
  invalid.set("personaIds", "p-1, p-2");
  assert.throws(() => personaReorderPayload(invalid), /valid JSON/);
});

test("bulk payloads parse a JSON array from the items field", () => {
  const personaForm = new FormData();
  personaForm.set(
    "items",
    ' [{"title":"01. Core","content":"Warm"},{"title":"02. Voice","content":"Short"}] ',
  );
  assert.deepEqual(personaBulkPayload(personaForm), {
    items: [
      { title: "01. Core", content: "Warm" },
      { title: "02. Voice", content: "Short" },
    ],
  });

  const memoryForm = new FormData();
  memoryForm.set("items", '[{"content":"met fan","reason":"consistency"}]');
  assert.deepEqual(memoryBulkPayload(memoryForm), {
    items: [{ content: "met fan", reason: "consistency" }],
  });
});

test("bulk payloads reject invalid or non-array JSON", () => {
  const invalidJson = new FormData();
  invalidJson.set("items", "not json");
  assert.throws(() => personaBulkPayload(invalidJson), /valid JSON/);

  const notArray = new FormData();
  notArray.set("items", '{"title":"Core"}');
  assert.throws(() => memoryBulkPayload(notArray), /JSON array/);

  const empty = new FormData();
  empty.set("items", "  ");
  assert.throws(() => personaBulkPayload(empty), /required/);
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

test("generation click actions map to runnable job endpoints", () => {
  assert.deepEqual(generationClickRequest("job-run", "job-1"), {
    path: "/api/generation/jobs/job-1/run",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  });
  assert.deepEqual(generationClickRequest("job-retry", "job-2"), {
    path: "/api/generation/jobs/job-2/retry",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  });
  assert.equal(generationClickRequest("job-complete", "job-3"), null);
});

test("dialog context carries the selected generation job id", () => {
  assert.deepEqual(
    dialogContextFromDataset({
      actor: "char-1",
      char: "char-2",
      user: "user-1",
      postId: "post-1",
      jobId: "job-1",
    }),
    {
      actor: "char-1",
      char: "char-2",
      user: "user-1",
      postId: "post-1",
      jobId: "job-1",
    },
  );
});

test("generation completion dialog submits the selected job", () => {
  const html = dialogBody({ type: "complete-job", ctx: { jobId: "job-1" } });

  assert.match(html, /data-action="generation-action"/);
  assert.match(html, /name="jobId" value="job-1"/);
  assert.match(html, /name="action" value="complete"/);
});

test("generation completion form delegates to the job request builder", async () => {
  const form = new FormData();
  form.set("jobId", "job-1");
  form.set("action", "complete");
  form.set("mediaId", "media-1");

  assert.deepEqual(
    await generationFormActionRequest("generation-action", form),
    {
      path: "/api/generation/jobs/job-1/complete",
      options: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaId: "media-1" }),
      },
    },
  );
  assert.equal(await generationFormActionRequest("dlg-new-job", form), null);
});

test("paymentDetailRequest targets payment detail endpoint", () => {
  assert.equal(paymentDetailRequest("pay-1"), "/api/payments/pay-1");
});

test("adminRequestOptions adds the admin bearer token header", () => {
  assert.deepEqual(adminRequestOptions({ method: "POST" }, " secret "), {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  });
});

test("adminLoginPayload trims credentials", () => {
  const form = new FormData();
  form.set("email", " admin@opod.com ");
  form.set("password", " qwer1234 ");

  assert.deepEqual(adminLoginPayload(form), {
    email: "admin@opod.com",
    password: "qwer1234",
  });
});

test("adminAccountPayload trims account fields", () => {
  const form = new FormData();
  form.set("email", " next@opod.com ");
  form.set("password", " next-pass ");

  assert.deepEqual(adminAccountPayload(form), {
    email: "next@opod.com",
    password: "next-pass",
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
      action: "admin-login",
      data: { email: "admin@opod.com", password: "qwer1234" },
      path: "/api/admin/login",
      method: "POST",
      body: { email: "admin@opod.com", password: "qwer1234" },
    },
    {
      action: "admin-create",
      data: { email: "next@opod.com", password: "next-pass" },
      path: "/api/admin/accounts",
      method: "POST",
      body: { email: "next@opod.com", password: "next-pass" },
    },
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
      action: "character-delete",
      dataset: { characterId: "char-1" },
      data: { reason: "policy" },
      path: "/api/characters/char-1",
      method: "DELETE",
      body: { reason: "policy" },
    },
    {
      action: "persona-create",
      dataset: { characterId: "char-1" },
      data: { title: "Core", content: "warm" },
      path: "/api/characters/char-1/personas",
      method: "POST",
      body: { title: "Core", content: "warm" },
    },
    {
      action: "persona-update",
      dataset: { characterId: "char-1", personaId: "persona-1" },
      data: { title: "Core", content: "warmer" },
      path: "/api/characters/char-1/personas/persona-1",
      method: "PATCH",
      body: { title: "Core", content: "warmer" },
    },
    {
      action: "persona-delete",
      dataset: { characterId: "char-1", personaId: "persona-1" },
      data: {},
      path: "/api/characters/char-1/personas/persona-1",
      method: "DELETE",
      body: {},
    },
    {
      action: "persona-bulk-create",
      dataset: { characterId: "char-1" },
      data: { items: '[{"title":"Core","content":"warm"}]' },
      path: "/api/characters/char-1/personas/bulk",
      method: "POST",
      body: { items: [{ title: "Core", content: "warm" }] },
    },
    {
      action: "persona-reorder",
      dataset: { characterId: "char-1" },
      data: { personaIds: '["persona-2","persona-1"]' },
      path: "/api/characters/char-1/personas/order",
      method: "PUT",
      body: { personaIds: ["persona-2", "persona-1"] },
    },
    {
      action: "memory-bulk-create",
      dataset: { characterId: "char-1" },
      data: { items: '[{"content":"city night","reason":"operator"}]' },
      path: "/api/characters/char-1/memory/bulk",
      method: "POST",
      body: { items: [{ content: "city night", reason: "operator" }] },
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
      action: "memory-update",
      dataset: { characterId: "char-1", memoryId: "memory-1" },
      data: { content: "city morning", reason: "operator" },
      path: "/api/characters/char-1/memory/memory-1",
      method: "PATCH",
      body: { content: "city morning", reason: "operator" },
    },
    {
      action: "memory-delete",
      dataset: { characterId: "char-1", memoryId: "memory-1" },
      data: {},
      path: "/api/characters/char-1/memory/memory-1",
      method: "DELETE",
      body: {},
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
        contentType: " feed ",
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
        contentType: "feed",
        content: "hello",
        reason: "daily",
        media: [{ mediaType: "image", url: "https://cdn.example/image.png" }],
      },
    },
    {
      action: "story-create",
      data: {
        characterId: " char-1 ",
        caption: " hello ",
        reason: " story ",
        mediaType: " image ",
        mediaUrl: " pod/stories/character/char-1/story.png ",
      },
      path: "/api/stories",
      method: "POST",
      body: {
        characterId: "char-1",
        caption: "hello",
        reason: "story",
        media: {
          mediaType: "image",
          url: "pod/stories/character/char-1/story.png",
        },
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
