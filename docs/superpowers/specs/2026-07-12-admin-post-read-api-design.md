# Admin Post Read API Design

## Goal

Expose authenticated admin APIs for listing posts and reading one post so the
v2 admin post section no longer depends on creation-only backend behavior.

## Scope

This change adds:

- `GET /api/posts`
- `GET /api/posts/:id`
- Cursor pagination for the list endpoint
- Optional `characterId` and `contentType` list filters

This change does not add comment or reaction counts, embedded character data,
comment/reaction reads, story reads, generation job reads, or admin UI changes.
Those are separate deliverables in the broader admin API work.

## API Contract

All endpoints remain protected by the existing `AdminJwtGuard` applied to
`AdminController`.

### List posts

`GET /api/posts`

Optional query parameters:

| Parameter | Type | Rules |
| --- | --- | --- |
| `characterId` | UUID string | Exact character ID match after trimming |
| `contentType` | `feed` or `reel` | Any other non-empty value returns HTTP 400 |
| `cursor` | base64url cursor | Must identify a post matching the active filters |
| `limit` | positive integer | Defaults to 20 and is capped at 50 |

Posts are ordered by `createdAt DESC`, then `id DESC`. The response uses the
existing admin page envelope:

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

`nextCursor` is omitted when there is no next page.

### Get one post

`GET /api/posts/:id`

The success response is one post in the same shape used by the list endpoint
and the existing `POST /api/posts` response.

## Post Representation

Each post contains:

- `id`
- `characterId`
- `contentType`
- `content`
- `media`, ordered by `PostMedia.sortOrder ASC`
- `hashtags`, ordered by hashtag name ascending
- `createdAt` as an ISO 8601 string

Nullable media metadata remains omitted through the existing `toPost`
conversion rather than being returned as `null`.

## Data Access

`AdminService` owns both reads, matching the existing post creation path. Both
queries reuse the existing `postWithMedia` Prisma relation configuration and
the existing `toPost` conversion. No schema migration is required.

For list pagination, the service:

1. Builds an exact-match Prisma filter from trimmed `characterId` and parsed
   `contentType`.
2. Decodes the cursor with the shared page helper.
3. Confirms the cursor post exists inside the active filter.
4. Reads `limit + 1` rows with deterministic descending order.
5. Converts rows and calls `pageFromRows` to emit `nextCursor` when needed.

## Errors

The API follows current admin conventions:

- Invalid `limit`: HTTP 400, `limit must be a positive integer`
- Invalid cursor encoding or a cursor outside the active filters: HTTP 400,
  `Invalid cursor`
- Invalid `contentType`: HTTP 400, `Invalid post content type`
- Missing post detail: HTTP 400, `Post not found`

The service does not separately validate that a filter `characterId` exists;
an unknown ID produces an empty page, which is normal list behavior.

## Testing

Focused service tests cover:

- Filter construction, deterministic ordering, `limit + 1`, and response
  pagination for post lists
- Cursor rejection when the cursor is not inside the active filters
- Detail conversion with ordered media and hashtags
- Missing post behavior
- Invalid `contentType` behavior

A controller test covers forwarding list query values through the shared page
parser and forwarding the detail path parameter. Before implementation, the
new tests must be observed failing for the missing methods/routes. After
implementation, the focused tests, full unit suite, lint, and build must pass.

## Change Boundaries

Only the admin API documentation, `AdminController`, `AdminService`, and their
focused tests are changed. Existing uncommitted work under `packages/admin` is
preserved and excluded from all commits for this API deliverable.
