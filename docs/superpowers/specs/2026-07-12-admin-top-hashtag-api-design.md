# Admin Top Hashtag API Design

## Goal

Expose a global hashtag ranking for the admin analytics section without
reusing the user-specific hashtag preference endpoint.

## Scope

This change adds `GET /api/analytics/hashtags` with a bounded `limit`. It ranks
hashtags by the number of linked posts across the full dataset. It does not add
date windows, cursor pagination, preference scores, schema changes, or UI work.

## Chosen Approach

`AdminService.listTopHashtags` queries `Hashtag` with its `posts` relation
count, orders by count descending and name ascending, and maps the Prisma count
to `postCount`. This is one database query and uses the canonical post-hashtag
relation rather than user preference scores.

A cursor is intentionally excluded because ranking membership can change when
posts are added. A bounded top-N result is the stable contract analytics needs.

## API Contract

`GET /api/analytics/hashtags?limit=10`

The controller-level `AdminJwtGuard` protects the endpoint.

| Parameter | Type             | Rules                              |
| --------- | ---------------- | ---------------------------------- |
| `limit`   | positive integer | Defaults to 10 and is capped at 50 |

```json
{
  "items": [
    { "hashtag": "opod", "postCount": 42 },
    { "hashtag": "launch", "postCount": 18 }
  ]
}
```

Hashtags with zero linked posts are eligible after all used hashtags. Equal
counts are ordered by hashtag name ascending.

## Errors

Invalid `limit` returns HTTP 400 `limit must be a positive integer`, using the
shared page query validation. There are no not-found or cursor errors.

## Testing

Service tests cover the Prisma relation-count query, deterministic ordering,
limit forwarding, and response mapping. HTTP tests cover default limit 10,
explicit limit parsing, and route forwarding. Full tests, lint, targeted
formatting, and build are required before the isolated implementation commit.

## Change Boundaries

Only hashtag analytics documentation, `AdminController`, `AdminService`, and
their focused tests change. Existing `packages/admin` modifications remain
untouched and excluded.
