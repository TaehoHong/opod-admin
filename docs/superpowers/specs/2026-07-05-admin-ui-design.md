# Admin UI Improvement Design

Date: 2026-07-05
Project: opod-admin

## Goal

Replace the current form-only admin screen with a sidebar-based operations
console for OPOD. The console must expose the major operational areas admins
need while making AI character management the deepest and most prominent
workflow.

## Assumptions

- Keep `packages/admin` dependency-free for the first version.
- Reuse existing `/api/*` admin endpoints before adding backend surface area.
- Do not replace the UI with React or a component framework in this pass.
- Existing character creation, post creation, generation job, credit grant, and
  media upload forms remain available, but move into task-specific screens.

## Navigation

The admin shell uses a persistent left sidebar. Initial tabs:

- Dashboard
- Users
- AI Characters
- Content / Media
- Generation Jobs
- Reports / Moderation
- Payments / Reconciliation
- Analytics / Logs
- Settings

The sidebar is always visible on desktop. On narrow screens it can collapse to a
top-level menu, but mobile polish is secondary because this is an operator tool.

## Screen Responsibilities

### Dashboard

Shows service health and a compact operations summary:

- Open reports
- Recent character action logs
- Generation job count
- Payment reconciliation issues
- Basic analytics metrics from `/api/analytics`

### Users

Uses existing user APIs:

- Search users by name or email through `/api/users?q=...`
- Open a user detail panel through `/api/users/:id`
- Show recent events through `/api/events?userId=...`
- Show hashtag preferences through `/api/hashtag-preferences?userId=...`
- Show credit ledger through `/api/credits/ledger?userId=...`
- Keep credit grant as an action on the selected user

### AI Characters

This is the core workflow.

Layout:

- Left column: searchable/filterable character list from `/api/characters`
- Main panel: selected character profile, status, interests, and bio
- Detail tabs: memory, posts/actions, generation jobs, action logs
- Right rail: operations queue related to reports, generation, and payment
  issues

Supported actions:

- Create character through `/api/characters`
- Edit display name, bio, and interests through `/api/characters/:id`
- Activate/deactivate through `/api/characters/:id/status`
- List and add character memory through `/api/characters/:id/memory`
- Create AI posts through `/api/posts`
- Queue generation jobs through `/api/generation/jobs`
- Start, retry, run, and complete generation jobs through existing job action
  endpoints
- Show recent character action logs from `/api/character-action-logs`

### Content / Media

Uses existing media and post APIs:

- List media through `/api/media`
- Filter by media type and uploaded state
- Show media detail through `/api/media/:id`
- Start and confirm uploads through `/api/media/uploads` and
  `/api/media/:id/confirm-upload`
- Keep manual post creation available for operators

### Generation Jobs

First version is action-oriented rather than a full scheduler:

- Queue a job
- Start queued jobs
- Run a provider-backed job
- Retry a job
- Complete a running job with a media URL or media ID

If the UI needs a true job list, add a backend list endpoint in a separate
backend change. Do not fake a job list from action logs.

### Reports / Moderation

Uses existing moderation APIs:

- List reports through `/api/moderation/reports`
- Filter by status
- Open report detail through `/api/moderation/reports/:id`
- Update status and resolution through `/api/moderation/reports/:id`
- When a report target links to a known character or post, provide a jump to the
  relevant admin area when possible

### Payments / Reconciliation

Uses existing payment APIs:

- List reconciliation rows through `/api/payments/reconciliation`
- Filter by reconciliation status and date range
- Open payment detail through `/api/payments/:id`
- Surface mismatch rows in the dashboard operations queue

### Analytics / Logs

Starts simple:

- Numeric metric cards from `/api/analytics`
- Recent character action logs from `/api/character-action-logs`
- Date filters where existing endpoints support them

No charting library is included in the first version.

### Settings

Contains operator-facing environment and status information only. Do not add
role management until backend auth/roles exist.

## Data Flow

The UI keeps a small in-memory state object:

- active tab
- selected entity IDs
- list filters and cursors
- loading/error state per panel

Each tab owns its fetch calls and renders into the main content area. Shared
helpers should stay small:

- `request(path, options)`
- pagination helpers
- table/list rendering helpers
- form serialization helpers
- status/error rendering helpers

Do not introduce a router dependency. Use hash navigation such as
`#characters` and `#users` if URL state is needed.

## Error Handling

- Show inline errors next to the panel or form that failed.
- Keep the raw JSON output available as a collapsible diagnostics panel, not as
  the primary UI.
- Disable submit buttons while a request is in flight.
- Keep successful action receipts short: status, ID, timestamp, and next action.
- Preserve backend validation messages returned by the API.

## Testing

Small checks only:

- Existing `npm run admin:check` must pass.
- Add node:test coverage for any non-trivial payload or render helper.
- Smoke test should still verify the UI shell and API proxy.
- Manual browser QA should cover sidebar tab switching, AI character selection,
  one successful form action, and one API error state.

## Out of Scope For First Version

- New frontend framework
- New chart library
- Role/permission management
- Backend schema changes
- A generation job list unless the backend adds one
- Mobile-first redesign
