# Admin Hashtag Analytics API

All endpoints require the `__Host-opod_admin_session` admin cookie.
State-changing requests also require the `x-opod-admin` header; when an
`Origin` header is supplied it must match the request origin.

## List top global hashtags

```http
GET /api/admin/v1/analytics/hashtags?limit=10
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
