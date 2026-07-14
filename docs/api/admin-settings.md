# Admin Settings API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

Settings are stored in the `admin_settings` key-value table. **DB values
override env vars** and apply from the next processed generation job — no
process restart needed. The raw API key is never returned by any endpoint;
responses expose only `{ set, last4 }`.

## Get generation provider settings

```http
GET /api/settings/generation
```

```json
{
  "falApiKey": { "set": true, "last4": "cd12" },
  "falImageModel": "fal-ai/nano-banana/edit",
  "falImageT2iModel": "fal-ai/nano-banana",
  "resolved": {
    "t2iProvider": "fal:fal-ai/nano-banana",
    "editProvider": "fal:fal-ai/nano-banana/edit",
    "sources": { "apiKey": "db", "editModel": "db", "t2iModel": "db" }
  },
  "worker": {
    "enabled": true,
    "dailyBudgetUsd": 2,
    "jobCostEstimateUsd": 0.08,
    "todaySpendUsd": 0.16
  }
}
```

- `falApiKey` is `{ "set": false }` when no DB key exists (an env key may
  still be in effect — check `resolved.sources.apiKey`).
- `resolved.*Provider` is the provider name the worker would route to right
  now (`local` when no key resolves).
- Each `sources` entry is `db`, `env`, or `none`.
- `worker` reflects env-driven worker config plus today's (KST) `costUsd` sum.

The same document also carries the **content-planner LLM** settings
(OpenAI-compatible chat completions, used by the draft worker):
`llmApiUrl`, `llmApiKey` (masked the same way), `llmModel`,
`resolved.plannerProvider` (`llm:<model>` or `local`), and
`resolved.plannerSources`. The LLM planner activates only when URL, key, and
model all resolve; otherwise the deterministic local planner runs.

## Update generation provider settings

```http
PUT /api/settings/generation
```

Body (all fields optional):

| Field | Semantics |
| --- | --- |
| `falApiKey` | omit = keep, `null`/blank = delete (fall back to env), string = save |
| `falImageModel` | same semantics; the reference-conditioning (edit) model |
| `falImageT2iModel` | same semantics; the cold-start text-to-image model |
| `llmApiUrl` | same semantics; planner LLM endpoint (OpenAI-compatible) |
| `llmApiKey` | same semantics; planner LLM key |
| `llmModel` | same semantics; planner LLM model |

```json
{ "falApiKey": "fal-...", "falImageModel": "fal-ai/nano-banana/edit" }
```

The response is the same shape as `GET`. Validation: strings only, key ≤ 500
chars, models ≤ 200 chars.

## Run the generation worker manually

```http
POST /api/generation/worker/run
```

Body: `{ "jobId": "<uuid>" }` (optional). With `jobId` it claims that specific
**queued image** job; without it, the next queued job. The claim is
conditional (`queued → running`, lease set, `attemptCount` incremented) and
processing continues in the background — the response returns immediately:

```json
{ "jobId": "0190d8d1-463b-7e36-a9ef-0242ac120010" }
```

- `{ "jobId": null }` (200-range) — no queued job was available.
- `400 Generation job is not queued (image jobs only)` — a specific `jobId`
  was requested but that job is not claimable.

Manual runs work regardless of `WORKER_ENABLED` (which only controls the
automatic polling loop). The run uses the currently resolved provider
settings, so a key saved via `PUT /api/settings/generation` applies
immediately.
