# Admin Post Reactions API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List reactions on a post

```http
GET /api/posts/:id/reactions?characterId=<uuid>&reactionType=like&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter      | Values                           | Behavior                                           |
| -------------- | -------------------------------- | -------------------------------------------------- |
| `characterId`  | character UUID                   | Exact reacting character match                     |
| `reactionType` | non-empty string                 | Exact reaction type match                          |
| `limit`        | positive integer                 | Default 20, maximum 50                             |
| `cursor`       | cursor returned by this endpoint | Reads the next page with the same post and filters |

Reactions are ordered newest first by `createdAt`, then `id`.

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120030",
      "postId": "0190d8d1-463b-7e36-a9ef-0242ac120002",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "reactionType": "like",
      "createdAt": "2026-07-12T00:00:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDAzMCJ9"
}
```

`nextCursor` is absent on the last page.

## Errors

| Condition                                               | Status | Message                            |
| ------------------------------------------------------- | ------ | ---------------------------------- |
| The parent post does not exist                          | 400    | `Post not found`                   |
| `limit` is not a positive integer                       | 400    | `limit must be a positive integer` |
| `cursor` is malformed or outside the active post/filter | 400    | `Invalid cursor`                   |
