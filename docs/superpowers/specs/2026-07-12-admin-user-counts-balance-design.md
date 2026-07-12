# Admin User Counts and Balance Design

## Goal

Expose user follow counts and accurate spendable credit balance so admin user
list/detail screens can show real operational values.

## Scope

This change adds:

- `followCount` to `GET /api/users` list items
- `followCount` and `creditBalance` to `GET /api/users/:id`

It does not add balance to list items, change credit policy, expose reservation
details, add sorting/filtering by these fields, change schemas, or edit the UI.

## Chosen Approach

The existing user select includes `_count.characterFollows`, flattened to
`followCount` for list and detail. Detail computes `creditBalance` with the same
policy as `opod-service-backend`:

1. Sum `remainingAmount` for grant entries with no expiry or expiry after one
   captured `now`.
2. Sum active reserved credit amounts with expiry after the same `now`.
3. Return `max(0, grant remainder - active reservations)`.

Balance stays detail-only to avoid two aggregates per row on user list pages.
Using ledger `amount` grant/debit totals would be incorrect because the current
credit system consumes grant buckets through `remainingAmount` and holds active
reservations before capture.

## API Contract

List item addition:

```json
{ "followCount": 7 }
```

Detail additions:

```json
{
  "followCount": 7,
  "creditBalance": 108
}
```

Both are non-negative integers. Existing identity fields and page behavior are
unchanged.

## Errors

Missing detail continues to return HTTP 400 `User not found`. No new validation
errors are introduced.

## Testing

Service tests cover list count selection/mapping, detail count mapping, active
grant and reservation aggregate filters using the same timestamp, clamping a
negative computed balance to zero, and avoiding balance aggregates for missing
users. Full tests, lint, targeted formatting, and build are required before the
isolated implementation commit.

## Change Boundaries

Only user API documentation, `AdminService`, and focused tests change. Existing
`packages/admin` modifications remain untouched and excluded.
