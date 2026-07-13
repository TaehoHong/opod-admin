# Admin Generation Jobs API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

Job lifecycle: `queued → running → completed | failed`. Transitions are atomic
(conditional on the expected current status); a transition from any other
status returns HTTP 400. Expired-lease `running` jobs are reclaimed by the
generation worker sweep (requeued while attempts remain, failed afterwards).

## List generation jobs

```http
GET /api/generation/jobs?characterId=<uuid>&status=queued&mediaType=image&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter     | Values                                     | Behavior                                  |
| ------------- | ------------------------------------------ | ----------------------------------------- |
| `characterId` | character UUID                             | Exact match                               |
| `status`      | `queued`, `running`, `completed`, `failed` | Exact match                               |
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
| `status` is unsupported                         | 400    | `Generation job status must be queued, running, completed, or failed`    |
| `mediaType` is unsupported                      | 400    | `Generation media type must be image or video`                           |
| `limit` is not a positive integer               | 400    | `limit must be a positive integer`                                       |
| `cursor` is malformed or outside active filters | 400    | `Invalid cursor`                                                         |
| transition from the wrong status                | 400    | `Only queued generation jobs can start` (and equivalents per transition) |
