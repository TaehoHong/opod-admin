# Admin Post Reaction List API Design

## Goal

Expose an authenticated admin API for reading reactions on a specific post so
operators can inspect reactions they currently can only create.

## Scope

This change adds `GET /api/posts/:id/reactions` with cursor pagination and
optional `characterId` and `reactionType` filters. It does not add reaction
detail, update, delete, aggregation, schema changes, or admin UI changes.

## Chosen Approach

The read stays in `AdminService`, beside `createPostReaction`,
`AdminPostReaction`, `hasPost`, and `toPostReaction`. Embedding reactions in
post detail would make the response unbounded; a separate service would add an
unnecessary module boundary for one list operation.

## API Contract

`GET /api/posts/:id/reactions`

The controller-level `AdminJwtGuard` protects the endpoint.

Optional query parameters:

| Parameter      | Type             | Rules                                                       |
| -------------- | ---------------- | ----------------------------------------------------------- |
| `characterId`  | UUID string      | Exact reacting character match after trimming               |
| `reactionType` | string           | Exact non-empty reaction type match after trimming          |
| `cursor`       | base64url cursor | Must identify a reaction under this post and active filters |
| `limit`        | positive integer | Defaults to 20 and is capped at 50                          |

Reactions are ordered by `createdAt DESC`, then `id DESC`.

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

`nextCursor` is omitted on the last page.

## Data Access

`AdminService.listPostReactions` verifies the parent post, builds a `postId`
filter with optional character and reaction type, validates the cursor inside
that filter, reads `limit + 1` rows in deterministic order, converts with
`toPostReaction`, and emits the shared page envelope.

## Errors

- Missing parent post: HTTP 400, `Post not found`
- Invalid `limit`: HTTP 400, `limit must be a positive integer`
- Malformed cursor or cursor outside the post/filter: HTTP 400, `Invalid cursor`

Blank optional filters are ignored. Unknown non-empty filters on an existing
post return an empty page.

## Testing

Service tests cover combined filters, pagination, ISO conversion, missing
parents, and invalid cursors. HTTP tests cover the nested path and query/page
forwarding. Full tests, lint, targeted formatting, and build are required before
the isolated implementation commit.

## Change Boundaries

Only reaction API documentation, `AdminController`, `AdminService`, and their
focused tests change. Existing `packages/admin` modifications remain untouched.
