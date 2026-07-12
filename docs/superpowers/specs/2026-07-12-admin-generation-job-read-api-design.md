# Admin Generation Job Read API Design

## Goal

Expose authenticated admin APIs for listing generation jobs and reading one
job so operators can inspect the queue and use existing lifecycle actions from
real job records.

## Scope

This change adds:

- `GET /api/generation/jobs`
- `GET /api/generation/jobs/:id`
- Cursor pagination for the list endpoint
- Optional `characterId`, `status`, and `mediaType` list filters

It does not change job lifecycle rules, add cancellation or deletion, introduce
new statuses, modify the schema, or edit the admin UI.

## Chosen Approach

Generation reads belong in `GenerationService`, next to enqueue/start/retry/
complete and the existing `GenerationJob` conversion. `AdminService` exposes
thin delegation methods so `AdminController` keeps its existing dependency and
logging responsibilities remain unchanged. This avoids duplicating generation
types and conversion logic in `AdminService`.

Keeping all reads directly in `AdminService` would require copying the private
generation representation. Creating a new read-only service would split one
small domain without providing a useful boundary. Both alternatives add more
code than the chosen approach.

## API Contract

All endpoints remain protected by the existing controller-level
`AdminJwtGuard`.

### List generation jobs

`GET /api/generation/jobs`

Optional query parameters:

| Parameter     | Type                                | Rules                                           |
| ------------- | ----------------------------------- | ----------------------------------------------- |
| `characterId` | UUID string                         | Exact character ID match after trimming         |
| `status`      | `queued`, `running`, or `completed` | Any other non-empty value returns HTTP 400      |
| `mediaType`   | `image` or `video`                  | Any other non-empty value returns HTTP 400      |
| `cursor`      | base64url cursor                    | Must identify a job matching the active filters |
| `limit`       | positive integer                    | Defaults to 20 and is capped at 50              |

Jobs are ordered by `createdAt DESC`, then `id DESC`. The response uses the
existing page envelope:

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120010",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "mediaType": "image",
      "prompt": "Portrait at sunset",
      "status": "completed",
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

`nextCursor` is omitted on the last page.

### Get one generation job

`GET /api/generation/jobs/:id`

The success response is one job in the same shape used by list items and the
existing lifecycle endpoints. A job without output media omits `outputMedia`.

## Data Access

`GenerationService.listJobs` builds exact filters, validates a decoded cursor
inside those filters, reads `limit + 1` rows with `outputMedia`, converts rows,
and calls the shared `pageFromRows` helper. `GenerationService.getJob` exposes
the existing lookup behavior currently used internally by lifecycle methods.

`AdminService.listGenerationJobs` and `AdminService.getGenerationJob` delegate
without reshaping results or recording action logs because reads are not
character actions.

## Errors

- Invalid `status`: HTTP 400, `Generation job status must be queued, running, or completed`
- Invalid `mediaType`: HTTP 400, `Generation media type must be image or video`
- Invalid `limit`: HTTP 400, `limit must be a positive integer`
- Malformed cursor or cursor outside active filters: HTTP 400, `Invalid cursor`
- Missing detail: HTTP 400, `Generation job not found`

An unknown filter `characterId` returns an empty page.

## Testing

Generation service tests cover filtered pagination, output media conversion,
invalid filtered cursors, invalid status/media type, detail lookup, and missing
detail. Admin service tests cover delegation. Controller HTTP tests cover query
parsing and detail ID forwarding. Each new behavior follows a RED/GREEN cycle.

Final verification runs focused tests, the complete unit suite, lint, targeted
format checks, and the production build. Existing unrelated Prettier failures
remain outside this change boundary.

## Change Boundaries

Only generation API documentation, generation service/controller paths, and
their focused tests change. Existing uncommitted files under `packages/admin`
remain untouched and excluded from commits.
