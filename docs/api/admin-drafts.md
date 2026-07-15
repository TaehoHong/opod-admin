# Admin Post Drafts API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

A draft is one unit of the automated content pipeline
(`docs/media-generation-pipeline.md`): concept planning → prompt build →
shot generation → review → publish. Status machine:

```text
planned → generating → needs_review → approved → published
                     ↘ failed          ↘ rejected
needs_review | failed → regenerating → needs_review
```

Drafts are processed by the in-process worker (`WORKER_ENABLED`): planning uses
the LLM planner (`LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`, local fallback
otherwise), shots become image generation jobs, and approved drafts are
published at `scheduledAt` (immediately when null). Drafts of inactive
characters are held (not planned, not published).

## List drafts

```http
GET /api/drafts?status=needs_review&characterId=<uuid>&limit=20&cursor=<cursor>
```

Every query parameter is optional. `status` must be one of the eight statuses
above. Drafts are ordered newest first.

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120030",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "draftType": "post",
      "contentType": "feed",
      "caption": "노을이 예뻤던 애월 산책",
      "hashtags": ["필름사진", "제주"],
      "status": "needs_review",
      "attemptCount": 1,
      "scheduledAt": "2026-07-13T10:00:00.000Z",
      "createdAt": "2026-07-12T00:00:00.000Z",
      "updatedAt": "2026-07-12T00:05:00.000Z"
    }
  ],
  "nextCursor": "..."
}
```

Optional fields appear only when set: `errorMessage`, `publishedPostId`,
`conceptJson` (planner output, including `shots`).

## Get a draft

```http
GET /api/drafts/:id
```

Adds `shots` — the latest generation job per cut with its best-of-N candidates:

```json
{
  "shots": [
    {
      "sortOrder": 0,
      "jobId": "0190d8d1-463b-7e36-a9ef-0242ac120040",
      "status": "completed",
      "prompt": "young woman ..., 해변 역광, film photography ...",
      "outputs": [
        { "mediaId": "...", "url": "...", "candidateIndex": 0, "selected": true },
        { "mediaId": "...", "url": "...", "candidateIndex": 1, "selected": false }
      ]
    }
  ]
}
```

## Create a draft (manual planning trigger)

```http
POST /api/drafts
Content-Type: application/json

{ "characterId": "<uuid>", "sceneHint": "골목 카페", "scheduledAt": "2026-07-13T10:00:00Z", "contentType": "feed" }
```

Only `characterId` is required. Creates a `planned` draft; the worker plans it
on the next tick. `sceneHint` is passed to the planner as a mandatory hint.
`mode: "manual"` opts out of the automatic pipeline — the operator drives each
step with the endpoints below.

## Manual pipeline steps

```http
POST /api/drafts/:id/plan
POST /api/drafts/:id/build-prompts
POST /api/drafts/:id/jobs/:jobId/generate   { "prompt": "...", "candidateCount": 2 }
POST /api/drafts/:id/publish
```

Each mirrors one automatic step (manual = step-execution mode of the automatic
pipeline) and returns the updated draft; failures are HTTP 400 with a reason
(404 when the draft does not exist).

- `plan` claims a `planned` draft and runs the planner. In manual mode the shot
  jobs are created in `draft` status with an **empty prompt**.
- `build-prompts` converts the planned Korean scenes (`paramsJson._shot.scene`)
  of all `draft`-state shots into image-model prompts in one batched builder
  call (planner LLM settings reused; deterministic fallback without them).
  Re-running while shots are still `draft` overwrites the prompts. Records
  `conceptJson.builderName`.
- `generate` (optionally) overrides the prompt/candidate count, then queues the
  shot and runs it immediately. Queuing a shot whose stored prompt is empty
  without providing one is rejected (400) — build prompts first.
- `publish` publishes an `approved` draft regardless of `scheduledAt`.

## Edit a draft

```http
PATCH /api/drafts/:id
Content-Type: application/json

{ "caption": "...", "hashtags": ["필름사진"], "scheduledAt": null }
```

Only `needs_review` or `approved` drafts can be edited (earlier statuses are
overwritten by the planner). `scheduledAt: null` clears the schedule
(publish immediately after approval). Hashtags are cleaned (leading `#`
stripped, deduplicated, max 5).

## Approve / reject

```http
POST /api/drafts/:id/approve
POST /api/drafts/:id/reject   { "reason": "구도가 어색함" }
```

Both require `needs_review` (atomic transition, HTTP 400 otherwise). Approved
drafts are published by the worker at `scheduledAt` (or immediately).

## Regenerate a shot

```http
POST /api/drafts/:id/jobs/:jobId/regenerate
Content-Type: application/json

{ "prompt": "다른 구도의 해변 장면 ..." }
```

Allowed from `needs_review` or `failed`. Creates a new generation job for the
same cut (`originJobId` lineage, prompt override optional) and moves the draft
to `regenerating`; it returns to `needs_review` when the new job completes.

## Select a shot output

```http
POST /api/drafts/:id/jobs/:jobId/select
Content-Type: application/json

{ "mediaId": "<candidate media uuid>" }
```

Switches the selected best-of-N candidate for a completed shot job. The
selected media per cut is what gets published.

## Posting policy (scheduler input)

```http
GET /api/characters/:id/posting-policy
PUT /api/characters/:id/posting-policy
Content-Type: application/json

{ "enabled": true, "weeklyCadence": 3, "hourStartKst": 18, "hourEndKst": 22 }
```

When enabled and the character is active, the worker scheduler creates a
`planned` draft whenever no pending draft exists and `7/weeklyCadence` days
have passed since the last one, with `scheduledAt` at a random time inside the
KST hour window. Defaults: disabled, 3/week, 18–22 KST. `weeklyCadence` is
1–21 and `hourStartKst < hourEndKst`.
