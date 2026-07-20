# Admin Generation Jobs API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

Staged image lifecycle: `draft → queued → running → completed | failed`.
`draft` means the prompt and candidate count are still editable; no provider
work begins until the draft is confirmed into `queued`. Transitions are atomic
(conditional on the expected current status). Expired-lease `running` jobs are
reclaimed by the generation worker sweep (requeued while attempts remain,
failed afterwards).

## List generation jobs

```http
GET /api/generation/jobs?characterId=<uuid>&status=queued&mediaType=image&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter     | Values                                     | Behavior                                  |
| ------------- | ------------------------------------------ | ----------------------------------------- |
| `characterId` | character UUID                             | Exact match                               |
| `status`      | `draft`, `queued`, `running`, `completed`, `failed` | Exact match                       |
| `mediaType`   | `image`, `video`                           | Exact match                               |
| `limit`       | positive integer                           | Default 20, maximum 50                    |
| `cursor`      | cursor returned by this endpoint           | Reads the next page with the same filters |

Jobs are ordered newest first by `createdAt`, then `id`.

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120010",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "mediaType": "image",
      "prompt": "Portrait at sunset",
      "status": "completed",
      "attemptCount": 1,
      "provider": "fal:flux-kontext",
      "outputMedia": {
        "mediaType": "image",
        "url": "https://cdn.example.com/generated.jpg",
        "width": 1024,
        "height": 1024
      },
      "createdAt": "2026-07-12T00:00:00.000Z",
      "updatedAt": "2026-07-12T00:01:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDAxMCJ9"
}
```

`nextCursor` is absent on the last page. Reusing a cursor with filters that do
not contain that job returns HTTP 400 `Invalid cursor`.

Optional fields appear only when set: `provider`, `originJobId` (manual-retry
lineage), `errorMessage` (failed jobs), `costUsd` (decimal string).

## Staged image generation workflow

These five endpoints implement request → prompt edit → confirm → select →
regenerate. All return the generation job shape described below. Provider work
starts only after `confirm`; creating and editing a draft never calls a
provider.

### 1. Create an image draft

```http
POST /api/generation/image-jobs/draft
Content-Type: application/json

{
  "characterId": "<uuid>",
  "inputPrompt": "street portrait",
  "candidateCount": 2,
  "aspectRatio": "16:9"
}
```

`characterId`, non-empty `inputPrompt`, and integer `candidateCount` from 1 to
4 are required. Optional `aspectRatio` (`"<w>:<h>"`, e.g. `"4:3"` for feed
posts, `"16:9"` for stories) is stored as the provider param
`paramsJson.aspect_ratio` and overrides the visual profile's `providerConfig`
default for this job; it is echoed back as `aspectRatio` on the response. The
response has `status: "draft"`, preserves `inputPrompt`, and returns the
compiled `prompt` after applying the character visual profile. It also
includes `candidateCount`, `mediaType: "image"`, `attemptCount: 0`,
`generationContext`, `createdAt`, and `updatedAt`.

### 2. Edit the draft

```http
PATCH /api/generation/jobs/:id/draft
Content-Type: application/json

{ "prompt": "edited final prompt", "candidateCount": 3 }
```

Both a non-empty final `prompt` and integer `candidateCount` from 1 to 4 are
required. Only a `draft` job can be edited. The response remains `draft` and
contains the updated `prompt` and `candidateCount`; the original `inputPrompt`
is unchanged.

### 3. Confirm the draft

```http
POST /api/generation/jobs/:id/confirm
```

Atomically changes `draft` to `queued`. Retrying confirm is idempotent and
returns the job in its current post-draft state. The worker may claim the job
only after this transition.

For an immediate manual worker run, independent of `WORKER_ENABLED`:

```http
POST /api/generation/worker/run
Content-Type: application/json

{ "jobId": "<uuid>" }
```

The response is `{ "jobId": "<uuid>" }`; processing continues in the
background. Poll `GET /api/generation/jobs/:id` until it reaches `completed` or
`failed`.

### 4. Select a completed output

```http
POST /api/generation/jobs/:id/select-output
Content-Type: application/json

{ "mediaId": "<candidate media uuid>" }
```

The media must belong to the completed job. Selection is idempotent: all of the
job's candidates are first marked `selected: false`, then the requested one is
marked `selected: true` and copied to `outputMediaId`. The response includes
the updated `outputs` and `outputMedia`.

### 5. Regenerate

```http
POST /api/generation/jobs/:id/regenerate
```

Only a completed or failed image job can be regenerated. This creates a new
`draft` with the same character, prompt, input prompt, candidate count, and
provider parameters. The new response has `originJobId` equal to the source
job ID; the source job is unchanged. The regenerated draft must be confirmed
before any provider work begins. A draft regenerated from a legacy job whose
candidate count is `null` omits `candidateCount`; the worker's configured
default applies when that draft is confirmed and processed.

### Generation job response fields

| Field | Presence and meaning |
| ----- | -------------------- |
| `id`, `characterId`, `mediaType`, `prompt`, `status` | Always present |
| `attemptCount`, `createdAt`, `updatedAt` | Always present |
| `inputPrompt` | Present for staged image jobs |
| `candidateCount` | Present for newly created or edited staged jobs; may be absent on drafts regenerated from legacy null-count jobs, in which case the worker default applies |
| `generationContext` | Present when the character visual profile was loaded |
| `outputs` | Present after candidates have been persisted; each item has `mediaId`, `url`, `candidateIndex`, `selected` |
| `outputMediaId`, `outputMedia` | Present only after selecting or otherwise assigning an output |
| `originJobId` | Present on retry/regeneration descendants |
| `provider`, `costUsd`, `errorMessage` | Present only when recorded |

## Get a generation job

```http
GET /api/generation/jobs/:id
```

The response is one job in the same shape as a list item, plus `outputs` — the
best-of-N candidate list recorded by the worker:

```json
{
  "outputs": [
    {
      "mediaId": "0190d8d1-463b-7e36-a9ef-0242ac120020",
      "url": "https://cdn.example.com/candidate-0.jpg",
      "candidateIndex": 0,
      "selected": true
    }
  ]
}
```

`outputMedia` is absent until the job completes with output. A missing job
returns HTTP 400 `Generation job not found`.

## Enqueue a generation job

```http
POST /api/generation/jobs
Content-Type: application/json

{ "characterId": "<uuid>", "mediaType": "image", "prompt": "Portrait at sunset" }
```

Creates a `queued` job. When the generation worker is enabled it claims queued
jobs automatically; the manual transitions below exist for operating without
the worker and for recovery.

## Start a generation job (manual)

```http
POST /api/generation/jobs/:id/start
```

Atomically moves a `queued` job to `running`, increments `attemptCount`, and
sets a 10-minute lease so an abandoned manual run can be reclaimed by the
worker sweep. Any other status returns HTTP 400
`Only queued generation jobs can start`.

## Run a generation job (manual)

```http
POST /api/generation/jobs/:id/run
Content-Type: application/json

{ "provider": "local" }
```

Same transition as start, recorded with the requested provider in the
character action log. Legacy endpoint; prefer the worker.

## Complete a generation job (manual)

```http
POST /api/generation/jobs/:id/complete
Content-Type: application/json

{ "mediaId": "<uploaded media uuid>" }
```

or

```json
{ "url": "https://cdn.example.com/generated.jpg", "width": 1024, "height": 1024 }
```

Only `running` jobs can complete. Completing again with the same payload is
idempotent (returns the completed job). `mediaId` must reference upload-
confirmed media. The `url` form stores media **without** `uploadedAt`, which
cannot be attached to posts or stories — use it only for inspection, never for
the publish pipeline.

## Fail a generation job (manual)

```http
POST /api/generation/jobs/:id/fail
Content-Type: application/json

{ "errorMessage": "provider rejected the prompt" }
```

Moves a `queued` or `running` job to `failed`. Failing an already-failed job is
idempotent. `errorMessage` defaults to `failed manually by admin`.

## Retry a generation job

```http
POST /api/generation/jobs/:id/retry
Content-Type: application/json

{ "reason": "transient provider error" }
```

Only `failed` jobs can be retried. Creates a **new** queued job (copying
character, media type, prompt, provider) linked to the source via
`originJobId`. Automatic retries inside the worker reuse the same row via
`attemptCount` instead.

## Validation errors

| Condition                                       | Status | Message                                                                  |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `status` is unsupported                         | 400    | `Generation job status must be draft, queued, running, completed, or failed` |
| `mediaType` is unsupported                      | 400    | `Generation media type must be image or video`                           |
| `candidateCount` is not an integer from 1 to 4 | 400    | ValidationPipe response identifying the failed integer/minimum/maximum constraint |
| `limit` is not a positive integer               | 400    | `limit must be a positive integer`                                       |
| `cursor` is malformed or outside active filters | 400    | `Invalid cursor`                                                         |
| transition from the wrong status                | 400    | `Only queued generation jobs can start` (and equivalents per transition) |
