# Admin Action Logs

Active admins can read character action records through the existing admin session guard.

```http
GET /api/admin/v1/character-action-logs?characterId=<uuid>&cursor=<cursor>&limit=20
GET /api/admin/v1/character-action-logs/:id
```

The list returns `{ items, nextCursor? }`. Detail returns one persisted record:
`id`, `characterId`, `actionType`, `targetTable?`, `targetId?`, `reason`, and
`createdAt`. BIGINT log IDs are decimal strings; timestamps are ISO strings.
Nullable target fields are omitted. The detail ID must be a positive decimal
PostgreSQL BIGINT. Invalid IDs return 400, missing records return 404, and
requests without an admin session return 401.

`AdminController` → `AdminService` → `CharacterActionLogService` →
`CharacterActionLogRepository.findById` owns the read path. This adds no schema
or write operation. `test/log-details.e2e-spec.ts` verifies the real database,
HTTP contract, authentication, and lossless IDs above JavaScript's safe integer limit.

The admin list opens `/logs/:logId` by clicking a row or activating its detail
link with the keyboard. The detail hierarchy is action/character/time, the
complete reason, then collapsed target/identifier fields. Character filters
remain in the URL when opening and returning from detail. Direct entry and
refresh do not depend on a loaded list. Detail times are labelled KST.
