# Admin Post Comment List API Design

## Goal

Expose an authenticated admin API for reading comments on a specific post so
operators can inspect the comments they currently can only create.

## Scope

This change adds `GET /api/posts/:id/comments` with cursor pagination and an
optional `characterId` filter. It does not add comment detail, update, delete,
counts, user-authored comments, schema changes, or admin UI changes.

## Chosen Approach

The read stays in `AdminService`, beside `createPostComment`, `AdminPostComment`,
`hasPost`, and `toPostComment`. A separate comments service would add a module
boundary for one list operation, while embedding comments in `GET /api/posts/:id`
would make post detail unbounded and prevent independent pagination.

## API Contract

`GET /api/posts/:id/comments`

The existing controller-level `AdminJwtGuard` protects the endpoint.

Optional query parameters:

| Parameter     | Type             | Rules                                                      |
| ------------- | ---------------- | ---------------------------------------------------------- |
| `characterId` | UUID string      | Exact comment author match after trimming                  |
| `cursor`      | base64url cursor | Must identify a comment under this post and active filters |
| `limit`       | positive integer | Defaults to 20 and is capped at 50                         |

Comments are ordered by `createdAt DESC`, then `id DESC`.

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

`nextCursor` is omitted on the last page.

## Data Access

`AdminService.listPostComments` first verifies the parent post exists. It then
builds a filter containing `postId` and optional `characterId`, validates the
cursor inside that filter, reads `limit + 1` comments in deterministic order,
converts rows with `toPostComment`, and emits the shared page envelope.

## Errors

- Missing parent post: HTTP 400, `Post not found`
- Invalid `limit`: HTTP 400, `limit must be a positive integer`
- Malformed cursor or cursor outside the post/filter: HTTP 400, `Invalid cursor`

An unknown `characterId` on an existing post returns an empty page.

## Testing

Service tests cover filtered pagination, ISO conversion, missing parent posts,
and cursors outside the active post/filter. HTTP tests cover path ID, query
forwarding, and page parsing. Each behavior is introduced with a failing test.
Full unit tests, lint, targeted formatting, and build are required before the
isolated implementation commit.

## Change Boundaries

Only comment API documentation, `AdminController`, `AdminService`, and their
focused tests change. Existing `packages/admin` modifications remain untouched
and excluded from commits.
