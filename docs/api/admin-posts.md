# Admin Posts API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List posts

```http
GET /api/posts?characterId=<uuid>&contentType=feed&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter     | Values                           | Behavior                                  |
| ------------- | -------------------------------- | ----------------------------------------- |
| `characterId` | character UUID                   | Exact match                               |
| `contentType` | `feed`, `reel`                   | Exact match                               |
| `limit`       | positive integer                 | Default 20, maximum 50                    |
| `cursor`      | cursor returned by this endpoint | Reads the next page with the same filters |

Posts are ordered newest first by `createdAt`, then `id`. A successful response
is:

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120002",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "contentType": "feed",
      "content": "A new post",
      "media": [
        {
          "mediaType": "image",
          "url": "https://cdn.example.com/post.jpg",
          "width": 1080,
          "height": 1080
        }
      ],
      "hashtags": ["launch", "opod"],
      "createdAt": "2026-07-12T00:00:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDAwMiJ9"
}
```

`nextCursor` is absent on the last page. Reusing a cursor with filters that do
not contain that cursor post returns HTTP 400 `Invalid cursor`.

## Get a post

```http
GET /api/posts/:id
```

The response is one post in the same shape as an item from the list endpoint.
A missing post returns HTTP 400 `Post not found`.

## Validation errors

| Condition                                           | Status | Message                                  |
| --------------------------------------------------- | ------ | ---------------------------------------- |
| `contentType` is not `feed` or `reel`               | 400    | `Post content type must be feed or reel` |
| `limit` is not a positive integer                   | 400    | `limit must be a positive integer`       |
| `cursor` is malformed or outside the active filters | 400    | `Invalid cursor`                         |
