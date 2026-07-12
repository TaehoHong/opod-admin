# Admin Story Read API Design

## Goal

Expose authenticated admin APIs for listing stories and reading one story so
operators can inspect story records that are currently creation-only.

## Scope

This change adds `GET /api/stories` and `GET /api/stories/:id`, cursor
pagination, and an optional `characterId` filter. It does not add active/expired
filtering, mutation endpoints, analytics, schema changes, or admin UI changes.

## Chosen Approach

Reads stay in `AdminService`, next to story creation, `AdminStory`, `PrismaStory`,
and `toStory`. Both reads reuse `include: { media: true }`. A separate story
service would duplicate the current ownership boundary for only two methods.

An expiry-state filter is intentionally excluded: current-time membership can
change between cursor requests and was not required. Each returned story still
includes `expiresAt`, allowing clients to classify it consistently.

## API Contract

### List stories

`GET /api/stories`

Optional query parameters:

| Parameter     | Type             | Rules                                       |
| ------------- | ---------------- | ------------------------------------------- |
| `characterId` | UUID string      | Exact character match after trimming        |
| `cursor`      | base64url cursor | Must identify a story inside active filters |
| `limit`       | positive integer | Defaults to 20 and is capped at 50          |

Stories are ordered by `createdAt DESC`, then `id DESC`.

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120040",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "caption": "Daily story",
      "media": {
        "mediaType": "image",
        "url": "https://cdn.example.com/story.jpg",
        "width": 1080,
        "height": 1920
      },
      "createdAt": "2026-07-12T00:00:00.000Z",
      "expiresAt": "2026-07-13T00:00:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDA0MCJ9"
}
```

### Get one story

`GET /api/stories/:id`

Returns one story in the same shape as a list item and the existing story
creation response.

## Data Access

`listStories` builds the optional character filter, validates decoded cursors
inside that filter, reads `limit + 1` rows with media, converts with `toStory`,
and emits the shared page envelope. `getStory` reads one row with media and uses
the same converter.

## Errors

- Invalid `limit`: HTTP 400, `limit must be a positive integer`
- Malformed cursor or cursor outside active filters: HTTP 400, `Invalid cursor`
- Missing detail: HTTP 400, `Story not found`

An unknown `characterId` returns an empty page.

## Testing

Service tests cover filtered pagination, media/date conversion, invalid
cursors, detail reads, and missing details. HTTP tests cover query parsing and
detail ID forwarding. Full tests, lint, targeted formatting, and build are
required before the isolated implementation commit.

## Change Boundaries

Only story API documentation, `AdminController`, `AdminService`, and their
focused tests change. Existing `packages/admin` modifications remain untouched.
