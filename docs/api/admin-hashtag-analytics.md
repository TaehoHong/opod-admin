# Admin Hashtag Analytics API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List top global hashtags

```http
GET /api/analytics/hashtags?limit=10
```

| Parameter | Values           | Behavior               |
| --------- | ---------------- | ---------------------- |
| `limit`   | positive integer | Default 10, maximum 50 |

Hashtags are ranked by linked post count descending. Equal counts are ordered
by hashtag name ascending.

```json
{
  "items": [
    { "hashtag": "opod", "postCount": 42 },
    { "hashtag": "launch", "postCount": 18 }
  ]
}
```

## Validation errors

| Condition                         | Status | Message                            |
| --------------------------------- | ------ | ---------------------------------- |
| `limit` is not a positive integer | 400    | `limit must be a positive integer` |
