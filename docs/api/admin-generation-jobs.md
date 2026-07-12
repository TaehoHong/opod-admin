# Admin Generation Jobs API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List generation jobs

```http
GET /api/generation/jobs?characterId=<uuid>&status=queued&mediaType=image&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter     | Values                           | Behavior                                  |
| ------------- | -------------------------------- | ----------------------------------------- |
| `characterId` | character UUID                   | Exact match                               |
| `status`      | `queued`, `running`, `completed` | Exact match                               |
| `mediaType`   | `image`, `video`                 | Exact match                               |
| `limit`       | positive integer                 | Default 20, maximum 50                    |
| `cursor`      | cursor returned by this endpoint | Reads the next page with the same filters |

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

## Get a generation job

```http
GET /api/generation/jobs/:id
```

The response is one job in the same shape as a list item. `outputMedia` is
absent until the job completes with output. A missing job returns HTTP 400
`Generation job not found`.

## Validation errors

| Condition                                       | Status | Message                                                       |
| ----------------------------------------------- | ------ | ------------------------------------------------------------- |
| `status` is unsupported                         | 400    | `Generation job status must be queued, running, or completed` |
| `mediaType` is unsupported                      | 400    | `Generation media type must be image or video`                |
| `limit` is not a positive integer               | 400    | `limit must be a positive integer`                            |
| `cursor` is malformed or outside active filters | 400    | `Invalid cursor`                                              |
