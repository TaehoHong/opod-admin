# Admin Users API

All endpoints require an admin JWT.

## List users

```http
GET /api/users?q=<term>&limit=20&cursor=<cursor>
```

Each item includes `followCount`, the number of characters followed by the
user:

```json
{
  "id": "0190d8d1-463b-7e36-a9ef-0242ac120050",
  "displayName": "Taeho",
  "email": "taeho@example.com",
  "followCount": 7,
  "createdAt": "2026-07-12T00:00:00.000Z"
}
```

## Get a user

```http
GET /api/users/:id
```

Detail includes `followCount` and current spendable `creditBalance`:

```json
{
  "id": "0190d8d1-463b-7e36-a9ef-0242ac120050",
  "displayName": "Taeho",
  "email": "taeho@example.com",
  "followCount": 7,
  "creditBalance": 108,
  "createdAt": "2026-07-12T00:00:00.000Z"
}
```

`creditBalance` sums unexpired grant-bucket remainders and subtracts active
reserved credits. It never returns a negative value. A missing user returns
HTTP 400 `User not found`.
