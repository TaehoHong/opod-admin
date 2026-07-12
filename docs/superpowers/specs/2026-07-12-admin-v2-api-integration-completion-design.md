# Admin v2 API Integration Completion Design

## Goal

Complete the interrupted OPOD Admin console v2 integration so the existing
Broadsheet UI uses the newly available admin read APIs and exposes working
post navigation and generation-job actions.

## Current State

`packages/admin/main.js` contains an uncommitted partial implementation from
the previous Claude session. It already renders character counts, post lists
and details, character posts, generation-job lists, and generation-job action
buttons. The post navigation and generation action buttons are not wired, and
the user and analytics screens still use the older API assumptions.

## Scope

This change completes the following existing screens without adding routes or
changing the Broadsheet design system:

- Character list and detail use `postCount` and `followerCount` returned by
  `GET /api/characters` and `GET /api/characters/:id`.
- Character detail posts use `GET /api/posts?characterId=...`.
- Character activity uses `GET /api/generation/jobs?characterId=...`.
- Post list and detail use `GET /api/posts` and `GET /api/posts/:id`.
- Post detail obtains comment and reaction totals from
  `GET /api/posts/:id/comments` and `GET /api/posts/:id/reactions` while
  retaining the existing create-comment and create-reaction dialogs.
- Post rows open the existing detail view, and the back action returns to the
  list. Navigating through the sidebar clears an active post selection.
- Generation list uses `GET /api/generation/jobs` with the existing status
  filter. Queued jobs can run, completed jobs can retry, and running jobs use
  the existing completion dialog. Successful actions refresh the list.
- User list shows `followCount` from `GET /api/users`. User detail shows
  `followCount` and the authoritative `creditBalance` from
  `GET /api/users/:id`; it does not derive balance from a paginated ledger.
- Analytics loads core metrics and top hashtags concurrently from
  `GET /api/analytics` and `GET /api/analytics/hashtags?limit=10`, replacing
  the obsolete “API unavailable” notice.

## Chosen Approach

Keep the current state-driven, framework-free SPA architecture. Complete the
existing `ui` state and delegated click handler rather than introducing a new
router, action dispatcher, or component abstraction. Reuse the tested
`generationActionRequest()` helper for run and retry requests.

This is the smallest approach that completes the interrupted work and keeps
the request contracts centralized. A hash-routed post detail or a generic
action framework would add persistence or extensibility that the current
scope does not require.

## Data and Interaction Flow

1. A section renderer requests the corresponding admin API with the current
   filter and converts paginated responses through `itemsFromPage()`.
2. Renderer output uses escaped response values and existing Broadsheet table,
   tag, statistic, and empty-state styles.
3. Delegated clicks update only the relevant selection state or submit a
   request through `submitViaSpec()`.
4. Successful mutations show the existing toast and call `renderApp()` so the
   refreshed API state replaces the previous table.
5. Failed reads render the section’s existing empty/error behavior; failed
   mutations retain the current view and are reported by `submitViaSpec()`.

## Testing

Tests must protect observable request and state-transition contracts rather
than HTML snapshots:

- Add failing tests for post selection/back/sidebar-reset state transitions.
- Add failing tests for the generation run/retry request selected by a click
  action.
- Add failing tests for the user and analytics request sets where a pure
  request helper improves confidence without duplicating browser markup.
- Run the focused Admin UI tests after each red-green cycle.
- Finish with the full Admin UI check, Prettier check, Nest build, and a
  browser pass using stubbed authenticated API responses for the changed
  sections.

## Change Boundaries

- Modify only `packages/admin/main.js` and meaningful Admin UI tests required
  to protect these interactions.
- Preserve the previous session’s uncommitted UI work and existing request and
  payload helper contracts.
- Do not add a story route or story screen.
- Do not expand the payment table in this change.
- Do not change backend controllers, services, Prisma access, or database
  schema.

