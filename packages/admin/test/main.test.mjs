import assert from "node:assert/strict";
import test from "node:test";
import {
  adminUserStats,
  analyticsDateRange,
  analyticsRequests,
  appendPostMediaFiles,
  characterCreatePayload,
  characterDeleteRequest,
  characterHref,
  characterMemoriesPanel,
  characterPersonasPanel,
  characterResourceFormRequest,
  characterRouteState,
  characterStatusPayload,
  characterUpdatePayload,
  adminAccountPayload,
  adminLoginPayload,
  adminRequestOptions,
  creditGrantPayload,
  currentRouteFromHash,
  dialogSessionAllows,
  dialogContextFromDataset,
  dialogBody,
  draftDetailMarkup,
  draftDetailSnapshot,
  endpoint,
  formActionRequest,
  generationActionBody,
  generationCandidateSelection,
  generationClickRequest,
  generationCommitRenderState,
  generationConfirmDraft,
  generationReplacePollTimer,
  generationRouteState,
  generationSettingsPayload,
  generationProvidersSummary,
  generationCreatePayload,
  generationFormActionRequest,
  generationActionRequest,
  generationWorkflowStep,
  generationWorkflowPanel,
  generationRequestPanel,
  imageDraftPayload,
  imageDraftUpdatePayload,
  imageWorkflowRequest,
  itemsFromPage,
  memoryBulkPayload,
  settingsView,
  memoryPayload,
  mediaTypeForFile,
  navItems,
  navBadgeRequests,
  parseResponseBody,
  paymentDetailRequest,
  personaBulkPayload,
  personaPayload,
  personaReorderPayload,
  postMediaGallery,
  postMediaSelectionItem,
  postSelectionAfterAction,
  postPayload,
  reportUpdatePayload,
  removePostMediaFile,
  simpleClickAction,
  storyPayload,
  submitNewPost,
  workerRunRequest,
} from "../main.js";

test("postMediaGallery renders image and video previews with escaped URLs", () => {
  const html = postMediaGallery([
    { mediaType: "image", url: "https://cdn.example/photo.png?a=1&b=2" },
    { mediaType: "video", url: "https://cdn.example/clip.mp4" },
  ]);

  assert.match(html, /<img/);
  assert.match(html, /<video[^>]*controls/);
  assert.match(html, /photo\.png\?a=1&amp;b=2/);
  assert.match(html, /clip\.mp4/);
});

test("postMediaGallery does not create active previews for unsafe URLs", () => {
  const html = postMediaGallery([
    { mediaType: "image", url: "javascript:alert(1)" },
  ]);

  assert.doesNotMatch(html, /src="javascript:/);
  assert.match(html, /javascript:alert\(1\)/);
});

test("pending new-post session blocks close and media mutations", () => {
  const session = { type: "new-post", submissionLocked: true };

  for (const action of [
    "close",
    "add-post-media",
    "drop-post-media",
    "remove-post-media",
  ]) {
    assert.equal(dialogSessionAllows(session, action), false, action);
  }
});

test("new-post session allows normal actions and successful completion", () => {
  const ready = { type: "new-post", submissionLocked: false };
  const pending = { type: "new-post", submissionLocked: true };

  assert.equal(dialogSessionAllows(ready, "close"), true);
  assert.equal(dialogSessionAllows(ready, "add-post-media"), true);
  assert.equal(dialogSessionAllows(pending, "submit-success"), true);
});

test("post media selection appends mixed files and removes by index", () => {
  const image = new File(["image"], "photo.png", { type: "image/png" });
  const video = new File(["video"], "clip.mp4", { type: "video/mp4" });
  const current = [image];
  const incoming = [video];

  const selected = appendPostMediaFiles(current, incoming);

  assert.notStrictEqual(selected, current);
  assert.notStrictEqual(selected, incoming);
  assert.deepEqual(selected, [image, video]);
  assert.deepEqual(current, [image]);
  assert.deepEqual(incoming, [video]);
  assert.equal(mediaTypeForFile(image), "image");
  assert.equal(mediaTypeForFile(video), "video");

  const remaining = removePostMediaFile(selected, 0);

  assert.notStrictEqual(remaining, selected);
  assert.deepEqual(remaining, [video]);
  assert.deepEqual(selected, [image, video]);
});

test("post media selection rejects unsupported files by name", () => {
  const text = new File(["notes"], "notes.txt", { type: "text/plain" });

  assert.throws(
    () => appendPostMediaFiles([], [text]),
    /notes\.txt.*image or video/i,
  );
});

test("postPayload uploads mixed media sequentially and preserves order", async () => {
  const form = new FormData();
  form.set("actorId", " character-1 ");
  form.set("content", " hello ");
  form.set("reason", " daily post ");
  form.set("contentType", " feed ");
  form.set("hashtags", " film, night ");
  const files = [
    new File(["image-bytes"], "photo.png", { type: "image/png" }),
    new File(["video-bytes"], "clip.mp4", { type: "video/mp4" }),
  ];
  const calls = [];
  let uploadNumber = 0;
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/media/uploads") {
      uploadNumber += 1;
      return {
        ok: true,
        body: {
          media: { id: `media-${uploadNumber}` },
          uploadUrl: `https://s3.example/upload-${uploadNumber}`,
          method: "PUT",
          headers: {
            "content-type": uploadNumber === 1 ? "image/png" : "video/mp4",
          },
        },
      };
    }
    return { ok: true, body: { id: path.split("/")[3] } };
  };
  const putObject = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const payload = await postPayload(form, request, putObject, files);

  assert.deepEqual(payload, {
    actorType: "character",
    actorId: "character-1",
    content: "hello",
    reason: "daily post",
    contentType: "feed",
    hashtags: ["film", "night"],
    media: [{ mediaId: "media-1" }, { mediaId: "media-2" }],
  });
  const presignBodies = calls
    .filter((call) => call.path === "/api/media/uploads")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(
    presignBodies.map(({ mediaType, storagePrefix }) => ({
      mediaType,
      storagePrefix,
    })),
    [
      {
        mediaType: "image",
        storagePrefix: "pod/feed/character/character-1",
      },
      {
        mediaType: "video",
        storagePrefix: "pod/feed/character/character-1",
      },
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.path ?? call.url),
    [
      "/api/media/uploads",
      "https://s3.example/upload-1",
      "/api/media/media-1/confirm-upload",
      "/api/media/uploads",
      "https://s3.example/upload-2",
      "/api/media/media-2/confirm-upload",
    ],
  );
});

test("postPayload identifies the failed file and does not continue", async () => {
  const form = new FormData();
  form.set("actorId", "character-1");
  form.set("content", "hello");
  form.set("reason", "daily post");
  form.set("contentType", "feed");
  form.set("hashtags", "");
  const files = [
    new File(["image"], "first.png", { type: "image/png" }),
    new File(["video"], "broken.mp4", { type: "video/mp4" }),
  ];
  let presignCount = 0;
  const request = async (path) => {
    if (path === "/api/media/uploads" && ++presignCount === 2) {
      return { ok: false, body: { message: "signing failed" } };
    }
    if (path === "/api/media/uploads") {
      return {
        ok: true,
        body: {
          media: { id: "media-1" },
          uploadUrl: "https://s3.example/first",
          method: "PUT",
          headers: { "content-type": "image/png" },
        },
      };
    }
    return { ok: true, body: { id: "media-1" } };
  };

  await assert.rejects(
    () => postPayload(form, request, async () => ({ ok: true }), files),
    /broken\.mp4.*signing failed/,
  );
});

function newPostForm() {
  const form = new FormData();
  form.set("actorId", "character-1");
  form.set("content", "hello");
  form.set("reason", "daily post");
  form.set("contentType", "feed");
  form.set("hashtags", "film, night");
  return form;
}

function newPostFiles() {
  return [
    new File(["first"], "first.png", { type: "image/png" }),
    new File(["second"], "second.mp4", { type: "video/mp4" }),
    new File(["third"], "third.png", { type: "image/png" }),
  ];
}

test("submitNewPost creates one post after all confirmations with ordered media", async () => {
  const events = [];
  let uploadNumber = 0;
  const request = async (path) => {
    events.push(path);
    if (path === "/api/media/uploads") {
      uploadNumber += 1;
      return {
        ok: true,
        body: {
          media: { id: `media-${uploadNumber}` },
          uploadUrl: `https://s3.example/upload-${uploadNumber}`,
          method: "PUT",
          headers: {},
        },
      };
    }
    return { ok: true, body: {} };
  };
  const putObject = async (url) => {
    events.push(url);
    return { ok: true };
  };
  const postRequests = [];
  const submit = async (requestSpec) => {
    events.push(requestSpec.path);
    postRequests.push(requestSpec);
    return { ok: true, body: { id: "post-1" } };
  };

  const result = await submitNewPost(
    newPostForm(),
    newPostFiles(),
    request,
    putObject,
    submit,
  );

  assert.equal(result.ok, true);
  assert.equal(postRequests.length, 1);
  assert.equal(postRequests[0].path, "/api/posts");
  assert.deepEqual(JSON.parse(postRequests[0].options.body).media, [
    { mediaId: "media-1" },
    { mediaId: "media-2" },
    { mediaId: "media-3" },
  ]);
  assert.deepEqual(events.slice(-2), [
    "/api/media/media-3/confirm-upload",
    "/api/posts",
  ]);
});

test("submitNewPost stops after a second-file upload stage failure", async (t) => {
  for (const failure of [
    { stage: "presign", message: "signing denied" },
    { stage: "put", message: "storage denied" },
    { stage: "confirm", message: "confirmation denied" },
  ]) {
    await t.test(failure.stage, async () => {
      const events = [];
      let uploadNumber = 0;
      const request = async (path) => {
        events.push(path);
        if (path === "/api/media/uploads") {
          uploadNumber += 1;
          if (failure.stage === "presign" && uploadNumber === 2) {
            return { ok: false, body: { message: failure.message } };
          }
          return {
            ok: true,
            body: {
              media: { id: `media-${uploadNumber}` },
              uploadUrl: `https://s3.example/upload-${uploadNumber}`,
              method: "PUT",
              headers: {},
            },
          };
        }
        if (
          failure.stage === "confirm" &&
          path === "/api/media/media-2/confirm-upload"
        ) {
          return { ok: false, body: { message: failure.message } };
        }
        return { ok: true, body: {} };
      };
      const putObject = async (url) => {
        events.push(url);
        if (failure.stage === "put" && url.endsWith("upload-2")) {
          return { ok: false, statusText: failure.message };
        }
        return { ok: true };
      };
      let postCount = 0;

      await assert.rejects(
        () =>
          submitNewPost(
            newPostForm(),
            newPostFiles(),
            request,
            putObject,
            async () => {
              postCount += 1;
              return { ok: true };
            },
          ),
        (error) => {
          assert.match(error.message, /second\.mp4/);
          assert.match(error.message, new RegExp(failure.message));
          return true;
        },
      );

      assert.equal(postCount, 0);
      assert.equal(uploadNumber, 2);
      assert.equal(
        events.some((event) => String(event).includes("upload-3")),
        false,
      );
    });
  }
});

test("submitNewPost rejects zero files before any upload or post request", async () => {
  let requestCount = 0;
  let putCount = 0;
  let postCount = 0;

  await assert.rejects(
    () =>
      submitNewPost(
        newPostForm(),
        [],
        async () => {
          requestCount += 1;
        },
        async () => {
          putCount += 1;
        },
        async () => {
          postCount += 1;
        },
      ),
    /At least one image or video file is required/,
  );

  assert.deepEqual(
    { requestCount, putCount, postCount },
    {
      requestCount: 0,
      putCount: 0,
      postCount: 0,
    },
  );
});

test("selected post media remove button names its escaped file", () => {
  const file = new File(["image"], 'photo&"wide.png', {
    type: "image/png",
  });

  const html = postMediaSelectionItem(file, 0, "blob:preview");

  assert.match(html, /aria-label="photo&amp;&quot;wide\.png 제거"/);
  assert.match(html, />제거<\/button>/);
  assert.doesNotMatch(html, /aria-label="photo&"/);
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
      "drafts",
      "generation",
      "logs",
      "users",
      "credits",
      "payments",
      "moderation",
      "events",
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

test("navBadgeRequests covers every badge shown in the design", () => {
  assert.deepEqual(navBadgeRequests(), [
    { key: "drafts", path: "/api/drafts?status=needs_review&limit=50" },
    { key: "generation", path: "/api/generation/jobs?status=failed&limit=50" },
    {
      key: "moderation",
      path: "/api/moderation/reports?status=submitted&limit=50",
    },
    {
      key: "payments",
      path: "/api/payments/reconciliation?status=mismatch",
    },
  ]);
});

test("analyticsRequests applies the selected reporting period", () => {
  const now = new Date("2026-07-12T12:00:00.000Z");
  assert.deepEqual(analyticsDateRange("7일", now), {
    from: "2026-07-05T12:00:00.000Z",
    to: "2026-07-12T12:00:00.000Z",
  });
  assert.deepEqual(analyticsRequests("30일", now), [
    "/api/analytics?from=2026-06-12T12%3A00%3A00.000Z&to=2026-07-12T12%3A00%3A00.000Z",
    "/api/analytics/hashtags?limit=10",
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
  assert.equal(currentRouteFromHash("#media", "token-1"), "characters");
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
    characterRouteState("#characters?characterId=char-1&tab=personas").tab,
    "personas",
  );
  assert.equal(
    characterRouteState("#characters?characterId=char-1&tab=memory").tab,
    "memory",
  );
  assert.equal(
    characterRouteState("#characters?characterId=char-1&tab=unknown").tab,
    "profile",
  );
});

test("characterPersonasPanel renders every editable persona safely", () => {
  const html = characterPersonasPanel("char-1", [
    {
      id: "persona-1",
      title: "Core <voice>",
      content: "Warm & concise",
      sortOrder: 10,
    },
    {
      id: "persona-2",
      title: "World",
      content: "Lives in Seoul",
      sortOrder: 20,
    },
  ]);

  assert.equal((html.match(/data-action="persona-update"/g) ?? []).length, 2);
  assert.match(html, /data-action="persona-create"/);
  assert.match(html, /data-persona-id="persona-1"/);
  assert.match(html, /data-persona-id="persona-2"/);
  assert.match(html, /Core &lt;voice&gt;/);
  assert.match(html, /Warm &amp; concise/);
  assert.doesNotMatch(html, /Core <voice>/);
});

test("characterPersonasPanel shows an empty state", () => {
  assert.match(
    characterPersonasPanel("char-1", []),
    /등록된 페르소나가 없습니다/,
  );
});

test("characterMemoriesPanel renders every editable memory safely", () => {
  const html = characterMemoriesPanel("char-1", [
    {
      id: "memory-1",
      content: "Likes <film>",
      reason: "Operator & import",
      createdAt: "2026-07-13T00:00:00.000Z",
    },
    {
      id: "memory-2",
      content: "Lives in Seoul",
      reason: "Profile",
      createdAt: "2026-07-12T00:00:00.000Z",
    },
  ]);

  assert.equal((html.match(/data-action="memory-update"/g) ?? []).length, 2);
  assert.match(html, /data-action="memory-create"/);
  assert.match(html, /data-memory-id="memory-1"/);
  assert.match(html, /data-memory-id="memory-2"/);
  assert.match(html, /Likes &lt;film&gt;/);
  assert.match(html, /Operator &amp; import/);
  assert.doesNotMatch(html, /Likes <film>/);
});

test("characterMemoriesPanel shows an empty state", () => {
  assert.match(
    characterMemoriesPanel("char-1", []),
    /등록된 메모리가 없습니다/,
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

test("characterResourceFormRequest selects persona and memory mutations", async () => {
  const persona = new FormData();
  persona.set("title", " Core ");
  persona.set("content", " Warm ");
  const personaSubmission = await characterResourceFormRequest(
    "persona-create",
    persona,
    { characterId: "char-1" },
  );
  assert.equal(personaSubmission.successMessage, "페르소나를 추가했습니다.");
  assert.equal(
    personaSubmission.request.path,
    "/api/characters/char-1/personas",
  );

  const memory = new FormData();
  memory.set("content", " City night ");
  memory.set("reason", " Operator ");
  const memorySubmission = await characterResourceFormRequest(
    "memory-update",
    memory,
    { characterId: "char-1", memoryId: "memory-1" },
  );
  assert.equal(memorySubmission.successMessage, "메모리를 저장했습니다.");
  assert.equal(
    memorySubmission.request.path,
    "/api/characters/char-1/memory/memory-1",
  );
  assert.equal(
    await characterResourceFormRequest("admin-login", new FormData()),
    null,
  );
});

test("characterDeleteRequest cancels or builds the selected soft delete", async () => {
  let prompt = "";
  assert.equal(
    await characterDeleteRequest(
      "persona-delete",
      { characterId: "char-1", personaId: "persona-1" },
      (message) => {
        prompt = message;
        return false;
      },
    ),
    null,
  );
  assert.match(prompt, /페르소나.*삭제/);

  const submission = await characterDeleteRequest(
    "memory-delete",
    { characterId: "char-1", memoryId: "memory-1" },
    () => true,
  );
  assert.equal(submission.successMessage, "메모리를 삭제했습니다.");
  assert.equal(
    submission.request.path,
    "/api/characters/char-1/memory/memory-1",
  );
  assert.equal(submission.request.options.method, "DELETE");
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

test("generation route and job state restore the workflow step", () => {
  assert.deepEqual(generationRouteState("#generation?jobId=job-1"), {
    jobId: "job-1",
  });
  assert.equal(generationWorkflowStep({ status: "draft" }), "prompt");
  assert.equal(generationWorkflowStep({ status: "queued" }), "generating");
  assert.equal(generationWorkflowStep({ status: "running" }), "generating");
  assert.equal(
    generationWorkflowStep({ status: "completed", outputMediaId: null }),
    "select",
  );
  assert.equal(
    generationWorkflowStep({
      status: "completed",
      outputMediaId: "media-1",
    }),
    "complete",
  );
  assert.equal(generationWorkflowStep({ status: "failed" }), "failed");
});

const generationCharacters = [
  { id: "ai-1", displayName: "하나" },
  { id: "ai-2", publicId: "duna" },
];
const generationSettings = {
  resolved: {
    t2iProvider: "fal-ai/nano-banana",
    editProvider: "fal-ai/nano-banana/edit",
  },
};
test("settings route hosts the provider/worker cards; generation shows a read-only summary", () => {
  const settings = {
    falApiKey: { set: true, last4: "cd12" },
    falImageModel: "fal-ai/nano-banana-pro/edit",
    falImageT2iModel: null,
    llmApiKey: { set: false },
    llmApiUrl: null,
    llmModel: null,
    resolved: {
      t2iProvider: "fal:fal-ai/nano-banana-pro",
      editProvider: "fal:fal-ai/nano-banana-pro/edit",
      plannerProvider: "llm:gpt-5.6-terra",
      sources: { apiKey: "db", editModel: "db", t2iModel: "env" },
      plannerSources: { apiUrl: "env", apiKey: "none", model: "env" },
    },
    worker: { enabled: true, dailyBudgetUsd: 2, jobCostEstimateUsd: 0.08, todaySpendUsd: 0 },
  };

  const view = settingsView(settings, 3);
  assert.match(view, /data-action="generation-settings"/);
  assert.match(view, /생성 워커/);
  // 개발자 흔적(HTTP 메서드·경로)은 카드 제목에서 사라졌다.
  assert.doesNotMatch(view, /PUT \/api\/settings/);
  assert.doesNotMatch(view, /POST \/api\/generation\/worker/);
  // env 폴백 필드는 값 유무와 무관하게 상시 태그로 표시된다.
  assert.match(view, /t2i 모델 \(콜드스타트\) <span class="tag tag-neutral"[^>]*>env 값 사용 중<\/span>/);
  assert.match(view, /API URL <span class="tag tag-neutral"[^>]*>env 값 사용 중<\/span>/);

  const summary = generationProvidersSummary(settings);
  assert.match(summary, /적용 중/);
  assert.match(summary, /fal:fal-ai\/nano-banana-pro\/edit/);
  assert.match(summary, /llm:gpt-5\.6-terra/);
  assert.match(summary, /href="#settings"/);
  // 요약은 읽기 전용 — 폼/저장 요소가 없어야 한다.
  assert.doesNotMatch(summary, /<form|<input/);

  assert.equal(generationProvidersSummary(null), "");
});

test("settings appears in the navigation contract", () => {
  assert.ok(navItems.some((item) => item.id === "settings" && item.label === "설정"));
});

const generationDraftJob = {
  id: "job-draft",
  characterId: "ai-1",
  mediaType: "image",
  inputPrompt: "성수동 산책",
  prompt: "하나가 성수동을 걷는 장면",
  candidateCount: 3,
  status: "draft",
  generationContext: {
    negativePrompt: "blur",
    referenceImageCount: 0,
    route: "t2i",
  },
};

test("generation workflow renders the editable prompt confirmation step", () => {
  const html = generationWorkflowPanel(
    generationDraftJob,
    [],
    generationCharacters,
    generationSettings,
  );

  assert.match(html, /요청 입력/);
  assert.match(html, /최종 프롬프트 확인/);
  assert.match(html, /후보 생성/);
  assert.match(html, /후보 선택/);
  assert.match(html, /하나가 성수동을 걷는 장면/);
  assert.match(html, /이미지 3장 생성/);
  assert.match(
    html,
    /<form[^>]*data-action="image-draft-update"[\s\S]*name="prompt"[\s\S]*name="candidateCount"[\s\S]*data-submit-action="image-confirm"[\s\S]*<\/form>/,
  );
});

test("generation prompt step shows the LLM-expanded scene when present", () => {
  const html = generationWorkflowPanel(
    {
      ...generationDraftJob,
      expandedScene: "성수동 골목, 오후의 자연광, 필름 질감",
      plannerName: "llm:gpt-5.6-terra",
    },
    [],
    generationCharacters,
    generationSettings,
  );

  assert.match(html, /LLM 확장 장면 \(llm:gpt-5\.6-terra\)/);
  assert.match(html, /성수동 골목, 오후의 자연광, 필름 질감/);
  assert.match(html, /장면 확장: llm:gpt-5\.6-terra/);
});

test("draft detail snapshot changes only on pipeline-visible state", () => {
  const base = {
    status: "generating",
    updatedAt: "2026-07-15T00:00:00.000Z",
    caption: "캡션",
    hashtags: ["태그"],
    shots: [
      {
        jobId: "job-1",
        status: "queued",
        outputs: [],
      },
    ],
  };

  // 파이프라인과 무관한 필드(conceptJson 등)는 스냅샷을 바꾸지 않는다.
  assert.equal(
    draftDetailSnapshot(base),
    draftDetailSnapshot({ ...base, conceptJson: { plan: {} } }),
  );
  // 컷 상태·후보·선택이 바뀌면 스냅샷이 바뀌어 리렌더가 일어난다.
  assert.notEqual(
    draftDetailSnapshot(base),
    draftDetailSnapshot({
      ...base,
      shots: [
        {
          jobId: "job-1",
          status: "completed",
          outputs: [{ mediaId: "m-1", selected: false }],
        },
      ],
    }),
  );
  assert.notEqual(
    draftDetailSnapshot(base),
    draftDetailSnapshot({ ...base, status: "needs_review" }),
  );
  // 프롬프트 빌드가 컷 프롬프트를 채우면 스냅샷이 바뀌어 리렌더가 일어난다.
  assert.notEqual(
    draftDetailSnapshot(base),
    draftDetailSnapshot({
      ...base,
      shots: [
        { jobId: "job-1", status: "queued", prompt: "built", outputs: [] },
      ],
    }),
  );
});

test("generation prompt step labels the missing planner as raw input", () => {
  const html = generationWorkflowPanel(
    generationDraftJob,
    [],
    generationCharacters,
    generationSettings,
  );

  assert.doesNotMatch(html, /LLM 확장 장면/);
  assert.match(html, /장면 확장: LLM 미설정 — 원문 사용/);
});

test("generation confirm saves current fields before confirming", async () => {
  const form = new FormData();
  form.set("prompt", "current edited prompt");
  form.set("candidateCount", "4");
  const calls = [];

  const outcome = await generationConfirmDraft(
    "job-1",
    form,
    async (...args) => {
      calls.push(args);
      return { ok: true, body: { id: "job-1" } };
    },
  );

  assert.equal(outcome.stage, "confirm");
  assert.deepEqual(
    calls.map(([path, options]) => ({
      path,
      method: options.method,
      body: JSON.parse(options.body),
    })),
    [
      {
        path: "/api/generation/jobs/job-1/draft",
        method: "PATCH",
        body: { prompt: "current edited prompt", candidateCount: 4 },
      },
      {
        path: "/api/generation/jobs/job-1/confirm",
        method: "POST",
        body: {},
      },
    ],
  );
});

test("generation confirm aborts when saving current fields fails", async () => {
  const form = new FormData();
  form.set("prompt", "current edited prompt");
  form.set("candidateCount", "2");
  const paths = [];

  const outcome = await generationConfirmDraft("job-1", form, async (path) => {
    paths.push(path);
    return { ok: false, body: { error: "draft conflict" } };
  });

  assert.equal(outcome.stage, "update");
  assert.deepEqual(paths, ["/api/generation/jobs/job-1/draft"]);
});

test("stale generation renders preserve selection and polling state", () => {
  const state = {
    generationSelectedJobId: "job-current",
    generationSelectedMediaId: "media-current",
    generationPollTimer: "timer-current",
  };
  let scheduled = 0;

  assert.equal(
    generationCommitRenderState(
      state,
      { id: "job-stale", status: "running" },
      {
        expectedToken: 7,
        currentToken: 8,
        route: "generation",
        hash: "#generation?jobId=job-stale",
      },
      () => {
        scheduled += 1;
        state.generationPollTimer = "timer-stale";
      },
    ),
    false,
  );
  assert.deepEqual(state, {
    generationSelectedJobId: "job-current",
    generationSelectedMediaId: "media-current",
    generationPollTimer: "timer-current",
  });
  assert.equal(scheduled, 0);
});

test("generation polling clears the old timer on route or job mismatch", () => {
  for (const runtime of [
    { route: "posts", hash: "#posts" },
    { route: "generation", hash: "#generation?jobId=job-new" },
  ]) {
    const cleared = [];
    const state = { generationPollTimer: "timer-old" };
    const scheduled = generationReplacePollTimer(state, "job-old", {
      clearTimer: (timer) => cleared.push(timer),
      setTimer: () => {
        throw new Error("must not schedule a mismatched job");
      },
      currentRoute: () => runtime.route,
      currentHash: () => runtime.hash,
      refresh: () => {},
    });

    assert.equal(scheduled, false);
    assert.deepEqual(cleared, ["timer-old"]);
    assert.equal(state.generationPollTimer, 0);
  }
});

test("candidate click remains local until final confirmation", () => {
  assert.deepEqual(generationCandidateSelection("job-1", "media-2"), {
    generationSelectedJobId: "job-1",
    generationSelectedMediaId: "media-2",
  });
  assert.deepEqual(imageWorkflowRequest("select", "job-1", "media-2"), {
    path: "/api/generation/jobs/job-1/select-output",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaId: "media-2" }),
    },
  });
});

test("generation workflow renders queued and running progress", () => {
  const queuedHtml = generationWorkflowPanel(
    { ...generationDraftJob, status: "queued", provider: "fal" },
    [],
    generationCharacters,
    generationSettings,
  );
  const runningHtml = generationWorkflowPanel(
    { ...generationDraftJob, status: "running", provider: "fal" },
    [],
    generationCharacters,
    generationSettings,
  );

  assert.match(queuedHtml, /생성 대기/);
  assert.match(runningHtml, /생성 중/);
});

test("generation workflow renders safe candidates for local selection", () => {
  const html = generationWorkflowPanel(
    {
      ...generationDraftJob,
      status: "completed",
      outputs: [
        {
          mediaId: "media-safe",
          url: "https://cdn.example/candidate.png?a=1&b=2",
          candidateIndex: 0,
          selected: false,
        },
        {
          mediaId: "media-unsafe",
          url: "javascript:alert(1)",
          candidateIndex: 1,
          selected: false,
        },
      ],
    },
    [],
    generationCharacters,
    generationSettings,
  );

  assert.match(html, /최종 확정/);
  assert.match(html, /https:\/\/cdn\.example\/candidate\.png\?a=1&amp;b=2/);
  assert.doesNotMatch(html, /javascript:/);
});

test("generation workflow renders final selection and collapsed history", () => {
  const history = [
    {
      ...generationDraftJob,
      id: "job-previous",
      status: "completed",
      outputMediaId: "media-old",
      costUsd: "0.12",
      outputs: [
        {
          mediaId: "media-old",
          url: "https://cdn.example/old.png",
          candidateIndex: 0,
          selected: true,
        },
      ],
    },
  ];
  const html = generationWorkflowPanel(
    {
      ...generationDraftJob,
      status: "completed",
      outputMediaId: "media-final",
      outputs: [
        {
          mediaId: "media-final",
          url: "https://cdn.example/final.png",
          candidateIndex: 0,
          selected: true,
        },
      ],
    },
    history,
    generationCharacters,
    generationSettings,
  );

  assert.match(html, /확정 완료/);
  assert.match(html, /프롬프트 수정 후 새 회차/);
  assert.match(html, /<details[^>]*class="generation-history"/);
  assert.match(html, /이전 생성 회차/);
  assert.match(html, /후보 수/);
  assert.match(html, /\$0\.12/);
});

test("generation workflow preserves a failed round and offers regeneration", () => {
  const html = generationWorkflowPanel(
    {
      ...generationDraftJob,
      status: "failed",
      errorMessage: "provider rejected the prompt",
    },
    [],
    generationCharacters,
    generationSettings,
  );

  assert.match(html, /provider rejected the prompt/);
  assert.match(html, /프롬프트 수정 후 새 회차/);
});

test("image draft payloads trim strings and cast candidate count", () => {
  const form = new FormData();
  form.set("characterId", " ai-1 ");
  form.set("inputPrompt", " street portrait ");
  form.set("prompt", " edited street portrait ");
  form.set("candidateCount", "3");

  assert.deepEqual(imageDraftPayload(form), {
    characterId: "ai-1",
    inputPrompt: "street portrait",
    candidateCount: 3,
  });
  assert.deepEqual(imageDraftUpdatePayload(form), {
    prompt: "edited street portrait",
    candidateCount: 3,
  });
});

test("generation request form offers post/story aspect ratio presets", () => {
  const html = generationRequestPanel(generationCharacters);

  assert.match(
    html,
    /<select[^>]*name="aspectRatio"[^>]*>[\s\S]*<option value="4:3" selected>게시글 \(4:3\)<\/option>[\s\S]*<option value="16:9">스토리 \(16:9\)<\/option>[\s\S]*<\/select>/,
  );
});

test("generation prompt step surfaces the job aspect ratio", () => {
  const withRatio = generationWorkflowPanel(
    { ...generationDraftJob, aspectRatio: "16:9" },
    [],
    generationCharacters,
    generationSettings,
  );
  assert.match(withRatio, /비율 16:9/);

  const withoutRatio = generationWorkflowPanel(
    generationDraftJob,
    [],
    generationCharacters,
    generationSettings,
  );
  assert.match(withoutRatio, /비율 프로필 기본/);
});

test("image draft payload carries the aspect ratio preset when selected", () => {
  const form = new FormData();
  form.set("characterId", "ai-1");
  form.set("inputPrompt", "street portrait");
  form.set("candidateCount", "3");
  form.set("aspectRatio", "16:9");

  assert.equal(imageDraftPayload(form).aspectRatio, "16:9");

  form.delete("aspectRatio");
  assert.equal("aspectRatio" in imageDraftPayload(form), false);
});

test("image draft payloads accept candidate count boundaries", () => {
  for (const candidateCount of ["1", "4"]) {
    const form = new FormData();
    form.set("characterId", "ai-1");
    form.set("inputPrompt", "street portrait");
    form.set("prompt", "edited portrait");
    form.set("candidateCount", candidateCount);

    assert.equal(
      imageDraftPayload(form).candidateCount,
      Number(candidateCount),
    );
    assert.equal(
      imageDraftUpdatePayload(form).candidateCount,
      Number(candidateCount),
    );
  }
});

test("image draft payloads reject invalid candidate counts", () => {
  for (const candidateCount of ["0", "5", "1.5", "", "not-a-number"]) {
    const form = new FormData();
    form.set("characterId", "ai-1");
    form.set("inputPrompt", "street portrait");
    form.set("prompt", "edited portrait");
    form.set("candidateCount", candidateCount);

    for (const payloadBuilder of [imageDraftPayload, imageDraftUpdatePayload]) {
      assert.throws(
        () => payloadBuilder(form),
        /candidateCount must be an integer between 1 and 4/,
        `${payloadBuilder.name}: ${JSON.stringify(candidateCount)}`,
      );
    }
  }
});

test("image workflow actions map to staged generation endpoints", () => {
  const createBody = {
    characterId: "ai-1",
    inputPrompt: "street portrait",
    candidateCount: 3,
  };
  const updateBody = { prompt: "edited portrait", candidateCount: 2 };
  const jsonHeaders = { "content-type": "application/json" };

  assert.deepEqual(imageWorkflowRequest("create", "", createBody), {
    path: "/api/generation/image-jobs/draft",
    options: {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(createBody),
    },
  });
  assert.deepEqual(imageWorkflowRequest("update", "job-1", updateBody), {
    path: "/api/generation/jobs/job-1/draft",
    options: {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(updateBody),
    },
  });
  assert.deepEqual(imageWorkflowRequest("confirm", "job-1"), {
    path: "/api/generation/jobs/job-1/confirm",
    options: {
      method: "POST",
      headers: jsonHeaders,
      body: "{}",
    },
  });
  assert.deepEqual(imageWorkflowRequest("select", "job-1", "media-2"), {
    path: "/api/generation/jobs/job-1/select-output",
    options: {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ mediaId: "media-2" }),
    },
  });
  assert.deepEqual(imageWorkflowRequest("regenerate", "job-1"), {
    path: "/api/generation/jobs/job-1/regenerate",
    options: {
      method: "POST",
      headers: jsonHeaders,
      body: "{}",
    },
  });
});

test("generation click actions map to runnable job endpoints", () => {
  // 실행 버튼은 워커 수동 실행을 쓴다 — 레거시 /run(프로바이더 미호출)이 아니라.
  assert.deepEqual(generationClickRequest("job-run", "job-1"), {
    path: "/api/generation/worker/run",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "job-1" }),
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

test("simple click actions map to their request and success message", () => {
  assert.deepEqual(simpleClickAction("settings-clear-key", {}), {
    request: {
      path: "/api/settings/generation",
      options: {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ falApiKey: null }),
      },
    },
    successMessage: "API 키를 삭제했습니다.",
  });
  assert.deepEqual(
    simpleClickAction("draft-build-prompts", { id: "draft-1" }),
    {
      request: {
        path: "/api/drafts/draft-1/build-prompts",
        options: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      },
      successMessage:
        "프롬프트를 빌드했습니다. 각 컷에서 확인·수정 후 실행하세요.",
    },
  );
  assert.deepEqual(
    simpleClickAction("draft-aggregate-now", { id: "draft-1" }),
    {
      request: {
        path: "/api/drafts/draft-1/aggregate",
        options: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      },
      successMessage: "생성 결과를 집계했습니다. 검수 단계를 확인하세요.",
    },
  );
  assert.deepEqual(simpleClickAction("draft-approve", { id: "draft-1" }), {
    request: {
      path: "/api/drafts/draft-1/approve",
      options: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    },
    successMessage: "초안을 승인했습니다. 예정 시각에 게시됩니다.",
  });
  assert.equal(simpleClickAction("generation-open", {}), null);
});

test("workerRunRequest targets the next or a specific queued job", () => {
  assert.deepEqual(workerRunRequest(), {
    path: "/api/generation/worker/run",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  });
  assert.deepEqual(JSON.parse(workerRunRequest(" job-9 ").options.body), {
    jobId: "job-9",
  });
});

test("generationSettingsPayload keeps a blank API key and clears blank models", () => {
  const form = new FormData();
  form.set("falApiKey", "   ");
  form.set("falImageModel", " fal-ai/nano-banana/edit ");
  form.set("falImageT2iModel", "");

  // 키 비움 = 필드 생략(기존 값 유지), 모델 빈 값 = null(env 폴백 복귀)
  assert.deepEqual(generationSettingsPayload(form), {
    falImageModel: "fal-ai/nano-banana/edit",
    falImageT2iModel: null,
    llmApiUrl: null,
    llmModel: null,
  });

  const withKey = new FormData();
  withKey.set("falApiKey", " fal-secret ");
  withKey.set("falImageModel", "fal-ai/nano-banana/edit");
  withKey.set("falImageT2iModel", "fal-ai/nano-banana");
  assert.deepEqual(generationSettingsPayload(withKey), {
    falApiKey: "fal-secret",
    falImageModel: "fal-ai/nano-banana/edit",
    falImageT2iModel: "fal-ai/nano-banana",
    llmApiUrl: null,
    llmModel: null,
  });
});

test("generationSettingsPayload carries planner LLM fields with the same semantics", () => {
  const form = new FormData();
  form.set("falImageModel", "");
  form.set("falImageT2iModel", "");
  form.set("llmApiKey", "  ");
  form.set("llmApiUrl", " https://llm.example/v1/chat/completions ");
  form.set("llmModel", "");

  // LLM 키 비움 = 유지(생략), URL은 저장, 모델 빈 값 = 삭제(null)
  assert.deepEqual(generationSettingsPayload(form), {
    falImageModel: null,
    falImageT2iModel: null,
    llmApiUrl: "https://llm.example/v1/chat/completions",
    llmModel: null,
  });

  const withKey = new FormData();
  withKey.set("llmApiKey", " sk-secret ");
  assert.equal(generationSettingsPayload(withKey).llmApiKey, "sk-secret");
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

test("new post dialog accepts multiple image and video files without URL fields", () => {
  const html = dialogBody({
    type: "new-post",
    ctx: { characters: [], actor: "" },
  });

  assert.match(html, /name="mediaFiles"/);
  assert.match(html, /type="file"/);
  assert.match(html, /multiple/);
  assert.match(html, /accept="image\/\*,video\/\*"/);
  assert.doesNotMatch(html, /name="mediaUrl"/);
  assert.doesNotMatch(html, /name="mediaType"/);
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

test("draft timeline offers a per-shot generation form for manual draft-state cuts", () => {
  const html = draftDetailMarkup(
    {
      id: "draft-1",
      characterId: "ai-1",
      contentType: "feed",
      status: "generating",
      attemptCount: 1,
      caption: "노을 산책",
      hashtags: ["필름사진"],
      createdAt: "2026-07-12T00:00:00.000Z",
      conceptJson: {
        source: "manual",
        mode: "manual",
        sceneHint: "애월 해변",
        plannerName: "test-planner",
        planInput: {
          personas: [{ title: "말투", content: "차분한 존댓말" }],
          memories: ["제주 애월 여행"],
          recentCaptions: ["지난 게시물"],
          sceneHint: "애월 해변",
        },
        plan: {
          caption: "노을 산책",
          hashtags: ["필름사진"],
          shots: [{ scene: "해변 역광" }],
        },
      },
      shots: [
        {
          sortOrder: 0,
          jobId: "job-1",
          status: "draft",
          prompt: "young woman, 해변 역광",
          scene: "해변 역광",
          candidateCount: 2,
          outputs: [],
        },
      ],
    },
    "한소이",
  );

  // 수동 진행 태그 + 컷별 "이미지 생성 실행" 폼이 노출된다.
  assert.match(html, /수동 진행/);
  assert.match(
    html,
    /<form[^>]*data-action="draft-shot-generate"[^>]*data-job-id="job-1"/,
  );
  assert.match(html, /이미지 생성 실행/);
  // 기획 입력 스냅샷 요약이 추적용으로 표시된다.
  assert.match(html, /페르소나 1 · 메모리 1 · 최근 캡션 1/);
});

test("draft timeline offers the prompt-build button for manual draft-state cuts", () => {
  const draft = {
    id: "draft-1",
    characterId: "ai-1",
    contentType: "feed",
    status: "generating",
    attemptCount: 1,
    caption: "노을 산책",
    hashtags: ["필름사진"],
    createdAt: "2026-07-12T00:00:00.000Z",
    conceptJson: {
      source: "manual",
      mode: "manual",
      plan: { caption: "노을 산책", hashtags: [], shots: [{ scene: "해변" }] },
    },
    shots: [
      {
        sortOrder: 0,
        jobId: "job-1",
        status: "draft",
        prompt: "",
        scene: "해변",
        outputs: [],
      },
    ],
  };

  // 빌드 전: "프롬프트 빌드" 버튼 + 빈 프롬프트 안내가 노출된다.
  const before = draftDetailMarkup(draft, "한소이");
  assert.match(before, /data-act="draft-build-prompts"[^>]*data-id="draft-1"/);
  assert.match(before, />프롬프트 빌드</);
  assert.match(before, /프롬프트가 비어 있습니다/);

  // 빌드 후: 재빌드 라벨 + 빌더 이름이 표시된다.
  const after = draftDetailMarkup(
    {
      ...draft,
      conceptJson: { ...draft.conceptJson, builderName: "llm:test" },
      shots: [{ ...draft.shots[0], prompt: "sunset walk, film look" }],
    },
    "한소이",
  );
  assert.match(after, />프롬프트 다시 빌드</);
  assert.match(after, /빌더: llm:test/);
  assert.doesNotMatch(after, /프롬프트가 비어 있습니다/);

  // 자동 모드에는 빌드 버튼이 없다 (워커가 기획과 함께 빌드).
  const auto = draftDetailMarkup(
    { ...draft, conceptJson: { ...draft.conceptJson, mode: "auto" } },
    "한소이",
  );
  assert.doesNotMatch(auto, /data-act="draft-build-prompts"/);
});

test("draft timeline shows the plan-now button for a planned draft with no cuts yet", () => {
  const html = draftDetailMarkup(
    {
      id: "draft-2",
      characterId: "ai-1",
      contentType: "feed",
      status: "planned",
      attemptCount: 0,
      caption: "",
      hashtags: [],
      createdAt: "2026-07-12T00:00:00.000Z",
      conceptJson: { source: "manual", mode: "manual", sceneHint: "카페" },
      shots: [],
    },
    "한소이",
  );

  assert.match(html, /data-act="draft-plan-now"[^>]*data-id="draft-2"/);
  assert.match(html, /지금 기획 실행/);
  assert.match(html, /기획이 완료되면 컷이 생성됩니다/);
  // 아직 기획 전이라 컷 생성 폼은 없어야 한다.
  assert.doesNotMatch(html, /data-action="draft-shot-generate"/);
});

test("draft timeline shows planner-selected references only for cuts that have them", () => {
  const shotBase = {
    sortOrder: 0,
    jobId: "job-ref",
    status: "completed",
    prompt: "young woman, 해변",
    scene: "해변 역광",
    outputs: [
      {
        candidateIndex: 0,
        mediaId: "out-media",
        url: "https://cdn.test/out-1.jpg",
        selected: true,
      },
    ],
  };
  const draftBase = {
    id: "draft-ref",
    characterId: "ai-1",
    contentType: "feed",
    status: "needs_review",
    attemptCount: 1,
    caption: "노을 산책",
    hashtags: ["필름사진"],
    createdAt: "2026-07-12T00:00:00.000Z",
    conceptJson: {
      source: "manual",
      mode: "manual",
      sceneHint: "애월 해변",
      plan: {
        caption: "노을 산책",
        hashtags: ["필름사진"],
        shots: [{ scene: "해변 역광" }],
      },
    },
  };

  const withRefs = draftDetailMarkup(
    {
      ...draftBase,
      shots: [
        {
          ...shotBase,
          references: [
            { mediaId: "ref-1", url: "https://cdn.test/ref-1.jpg" },
            { mediaId: "ref-2", url: "https://cdn.test/ref-2.jpg" },
          ],
        },
      ],
    },
    "한소이",
  );
  // 선별 소제목 + 장수 + 각 썸네일 URL이 운영자 추적용으로 노출된다.
  assert.match(withRefs, /선별 레퍼런스 2장/);
  assert.ok(withRefs.includes("https://cdn.test/ref-1.jpg"));
  assert.ok(withRefs.includes("https://cdn.test/ref-2.jpg"));

  const withoutRefs = draftDetailMarkup(
    { ...draftBase, shots: [shotBase] },
    "한소이",
  );
  // 선별 없이 전체 레퍼런스를 쓰는 컷(폴백)은 별도 표시가 없다.
  assert.doesNotMatch(withoutRefs, /선별 레퍼런스/);
});

test("candidate images zoom on click; selection is a separate control", () => {
  const draftBase = {
    id: "draft-x",
    characterId: "ai-1",
    contentType: "feed",
    status: "needs_review",
    attemptCount: 1,
    caption: "c",
    hashtags: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    conceptJson: { source: "manual", mode: "manual" },
  };
  const shot = {
    sortOrder: 0,
    jobId: "job-x",
    status: "completed",
    prompt: "p",
    outputs: [
      {
        candidateIndex: 0,
        mediaId: "m-sel",
        url: "https://cdn.test/sel.jpg",
        selected: true,
      },
      {
        candidateIndex: 1,
        mediaId: "m-unsel",
        url: "https://cdn.test/unsel.jpg",
        selected: false,
      },
    ],
  };
  const html = draftDetailMarkup({ ...draftBase, shots: [shot] }, "한소이");

  // 이미지는 클릭 시 확대(zoom-image), 선택 액션은 이미지에 붙지 않는다.
  assert.match(
    html,
    /data-act="zoom-image"[^>]*data-url="https:\/\/cdn\.test\/unsel\.jpg"/,
  );
  assert.doesNotMatch(html, /data-act="draft-pick-output"[^>]*<img/);
  // 미선택 후보는 "이 컷 선택" 버튼, 선택된 후보는 선택됨 표시.
  assert.match(
    html,
    /<button[^>]*data-act="draft-pick-output"[^>]*data-media="m-unsel"[^>]*>이 컷 선택<\/button>/,
  );
  assert.match(html, /✓ 선택됨/);
  assert.doesNotMatch(
    html,
    /data-act="draft-pick-output"[^>]*data-media="m-sel"/,
  );
});

test("review stage offers manual aggregation once every shot completed", () => {
  const draftBase = {
    id: "draft-agg",
    characterId: "ai-1",
    contentType: "feed",
    status: "generating",
    attemptCount: 1,
    caption: "c",
    hashtags: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    conceptJson: { source: "manual", mode: "manual" },
  };
  const doneShot = {
    sortOrder: 0,
    jobId: "job-a",
    status: "completed",
    prompt: "p",
    outputs: [],
  };

  const ready = draftDetailMarkup({ ...draftBase, shots: [doneShot] }, "한소이");
  assert.match(ready, /집계 대기/);
  assert.match(
    ready,
    /data-act="draft-aggregate-now"[^>]*data-id="draft-agg"[^>]*>검수로 보내기</,
  );

  const generating = draftDetailMarkup(
    { ...draftBase, shots: [doneShot, { ...doneShot, sortOrder: 1, status: "running" }] },
    "한소이",
  );
  assert.doesNotMatch(generating, /draft-aggregate-now/);
});

test("draft-level finish preset select and preview toggle follow conceptJson.finish", () => {
  const draftBase = {
    id: "draft-f",
    characterId: "ai-1",
    contentType: "feed",
    status: "needs_review",
    attemptCount: 1,
    caption: "c",
    hashtags: [],
    createdAt: "2026-07-12T00:00:00.000Z",
    conceptJson: { source: "manual", mode: "manual" },
  };
  const shot = {
    sortOrder: 0,
    jobId: "job-f",
    status: "completed",
    prompt: "p",
    outputs: [
      {
        candidateIndex: 0,
        mediaId: "m-1",
        url: "https://cdn.test/one.jpg",
        selected: false,
      },
    ],
  };

  // 프리셋 미설정: 셀렉트는 none 선택 상태, 미리보기 토글은 없다.
  const unset = draftDetailMarkup({ ...draftBase, shots: [shot] }, "한소이");
  assert.match(unset, /data-select="draft-finish"[^>]*data-id="draft-f"/);
  assert.match(unset, /<option value="none" selected>없음<\/option>/);
  assert.match(unset, /<option value="film">필름<\/option>/);
  assert.match(unset, /<option value="mono-film">흑백 필름<\/option>/);
  assert.doesNotMatch(unset, /draft-film-toggle/);

  // 프리셋 설정: 셀렉트 반영 + 토글 노출 + 후보 이미지에 스왑용 속성.
  const filmDraft = {
    ...draftBase,
    conceptJson: { ...draftBase.conceptJson, finish: "film" },
    shots: [shot],
  };
  const off = draftDetailMarkup(filmDraft, "한소이");
  assert.match(off, /<option value="film" selected>필름<\/option>/);
  assert.match(off, /data-act="draft-film-toggle"[^>]*aria-pressed="false"/);
  assert.match(
    off,
    /data-film-media="m-1"[^>]*data-orig-url="https:\/\/cdn\.test\/one\.jpg"[^>]*data-finish-preset="film"/,
  );

  // 미리보기 ON: 눌린 상태 + 게시 시 적용된다는 안내.
  const on = draftDetailMarkup(filmDraft, "한소이", { filmPreview: true });
  assert.match(on, /data-act="draft-film-toggle"[^>]*aria-pressed="true"/);
  assert.match(on, /게시 시 이 마감이 그대로 적용/);

  // 검수 불가 상태(published)에서는 셀렉트가 비활성화된다.
  const published = draftDetailMarkup(
    { ...filmDraft, status: "published" },
    "한소이",
  );
  assert.match(published, /data-select="draft-finish"[^>]*disabled/);

  // 완료된 후보가 없으면(생성 전) 셀렉트·토글 모두 없다.
  const none = draftDetailMarkup(
    {
      ...draftBase,
      shots: [{ ...shot, status: "draft", prompt: "", outputs: [] }],
    },
    "한소이",
  );
  assert.doesNotMatch(none, /draft-finish/);
  assert.doesNotMatch(none, /draft-film-toggle/);
});
