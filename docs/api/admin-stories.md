# Admin Stories API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List stories

```http
GET /api/stories?characterId=<uuid>&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter     | Values                           | Behavior                                  |
| ------------- | -------------------------------- | ----------------------------------------- |
| `characterId` | character UUID                   | Exact match                               |
| `limit`       | positive integer                 | Default 20, maximum 50                    |
| `cursor`      | cursor returned by this endpoint | Reads the next page with the same filters |

Stories are ordered newest first by `createdAt`, then `id`.

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120040",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "caption": "Daily story",
      "media": {
        "mediaType": "image",
        "url": "https://cdn.example.com/story.jpg",
        "width": 1080,
        "height": 1920
      },
      "createdAt": "2026-07-12T00:00:00.000Z",
      "expiresAt": "2026-07-13T00:00:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDA0MCJ9"
}
```

`nextCursor` is absent on the last page.

## Get a story

```http
GET /api/stories/:id
```

The response is one story in the same shape as a list item. A missing story
returns HTTP 400 `Story not found`.

## Validation errors

| Condition                                       | Status | Message                            |
| ----------------------------------------------- | ------ | ---------------------------------- |
| `limit` is not a positive integer               | 400    | `limit must be a positive integer` |
| `cursor` is malformed or outside active filters | 400    | `Invalid cursor`                   |
