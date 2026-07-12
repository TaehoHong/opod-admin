# Admin Character Count Fields Design

## Goal

Expose each character's post and follower counts in existing admin character
list and detail responses so the v2 character table can show real values.

## Scope

This change adds `postCount` and `followerCount` to:

- `GET /api/characters` list items
- `GET /api/characters/:id` detail

It does not change character create/update/status receipts, add sorting or
filtering by counts, change schemas, or edit the admin UI.

## Chosen Approach

Extend the existing `characterListFields` Prisma select with `_count.posts` and
`_count.userFollowers`. `toCharacterListItem` maps these relation counts to
flat numeric response fields. The detail response already spreads the same list
item conversion, so both endpoints stay consistent with one query each.

Separate count queries would create N+1 behavior on list pages. Persisted
counter columns would require migrations and synchronization that are not
needed for current admin scale.

## API Contract

Character list items and details add:

```json
{
  "postCount": 12,
  "followerCount": 340
}
```

Both fields are non-negative integers and return `0` when no related rows
exist. All existing fields and pagination behavior remain unchanged.

## Data Mapping

- Prisma `_count.posts` becomes `postCount`.
- Prisma `_count.userFollowers` becomes `followerCount`.

The `_count` object is not exposed in the API response.

## Testing

Service tests cover list query selection, count flattening, and detail response
consistency. Existing persona/memory detail behavior remains covered. Full unit
tests, lint, targeted formatting, and build are required before the isolated
implementation commit.

## Change Boundaries

Only character API documentation, `CharactersService`, and its focused tests
change. Existing `packages/admin` modifications remain untouched and excluded.
