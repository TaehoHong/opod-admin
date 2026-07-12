# Admin Post Comments API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List comments on a post

```http
GET /api/posts/:id/comments?characterId=<uuid>&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter     | Values                           | Behavior                                           |
| ------------- | -------------------------------- | -------------------------------------------------- |
| `characterId` | character UUID                   | Exact author match                                 |
| `limit`       | positive integer                 | Default 20, maximum 50                             |
| `cursor`      | cursor returned by this endpoint | Reads the next page with the same post and filters |

Comments are ordered newest first by `createdAt`, then `id`.

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120020",
      "postId": "0190d8d1-463b-7e36-a9ef-0242ac120002",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "body": "Looks great",
      "createdAt": "2026-07-12T00:00:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDAyMCJ9"
}
```

`nextCursor` is absent on the last page.

## Errors

| Condition                                               | Status | Message                            |
| ------------------------------------------------------- | ------ | ---------------------------------- |
| The parent post does not exist                          | 400    | `Post not found`                   |
| `limit` is not a positive integer                       | 400    | `limit must be a positive integer` |
| `cursor` is malformed or outside the active post/filter | 400    | `Invalid cursor`                   |
