# Admin Character Persona and Memory CRUD Design

## Goal

Show every persona and memory for a character in dedicated Admin character
detail tabs, with individual create, read, update, and delete controls.

## Current State

`GET /api/characters/:id` already returns all active personas in prompt
assembly order and all active memories. The backend also already exposes
create, update, and soft-delete endpoints for both resource types.

The Admin character profile renders only `personas[0]`, so all other personas
are hidden. Memories are listed alongside the profile and support only a
content-only quick-add action. The existing Admin request helper already knows
the persona and memory CRUD endpoint contracts, but the character detail UI
does not expose them.

## Scope

- Change the character detail tabs to `Profile`, `Personas`, `Memory`,
  `Posts`, `Activity`, `Visual`, and `Automation`.
- Keep the Profile tab limited to display name, bio, and interests.
- Show every active persona in the Personas tab in the order returned by the
  character detail API.
- Allow an operator to create a persona with title, content, and an optional
  numeric sort order.
- Allow an operator to update each persona's title, content, and sort order.
- Allow an operator to delete each persona after explicit confirmation.
- Show every active memory in the Memory tab in the order returned by the
  character detail API.
- Allow an operator to create and update memories with required content and
  reason fields.
- Allow an operator to delete each memory after explicit confirmation.
- Show clear empty states when a character has no active personas or memories.

The change does not add database fields, backend routes, bulk-edit controls,
drag-and-drop ordering, deleted-item recovery, or a new frontend framework.

## Chosen Approach

Add Personas and Memory as top-level character detail tabs in the existing
hash-routed, framework-free Admin SPA. Render a create form and a collection
of independent edit forms in each management tab. Reuse the existing
`formActionRequest()` contracts and delegated form/click handlers for all
mutations.

This is more discoverable than nesting management tabs under Profile and much
smaller than creating separate screens or routes. An editable `sortOrder`
field preserves the existing prompt assembly control without adding a new
reordering interaction.

## UI and Interaction Design

### Profile

The Profile tab retains the existing character update form but removes the
first-persona textarea and the memory list/add form. Saving Profile sends only
the character display name, bio, and interests update.

### Personas

The Personas tab displays the active persona count, a new-persona form, and
one edit form per persona. Each item exposes title, content, and sort order,
plus Save and Delete actions. The list follows the API order so the screen
matches prompt assembly order. A blank sort order on create lets the backend
append the entry using its existing numbering behavior.

### Memory

The Memory tab displays the active memory count, a new-memory form, and one
edit form per memory. Each item exposes content and reason, plus Save and
Delete actions. Creation time remains visible as non-editable context.

All response text placed in markup is escaped through the Admin's existing
escaping helpers.

## Data and Request Flow

1. Character detail continues to load `GET /api/characters/:id`; no extra
   persona or memory read request is necessary.
2. The hash router accepts `personas` and `memory` as character tab values and
   preserves the active tab during refreshes.
3. Create and update forms build requests through the existing persona and
   memory payload/request helpers.
4. Delete actions identify both the character ID and resource ID, ask for
   confirmation, and use the existing soft-delete endpoints.
5. While a form request is pending, that form's controls are disabled to
   prevent duplicate submission.
6. A successful mutation shows the existing success toast and rerenders the
   current character detail tab from the server response.
7. A failed mutation keeps the current view in place and shows the server
   error through the existing error toast.

## Validation and Error Handling

- Persona title and content are required. Persona sort order is optional on
  create and numeric when present.
- Memory content and reason are required for create and update.
- Destructive actions require confirmation because the Admin API has no
  deleted-item restore endpoint.
- The UI does not optimistically remove or alter entries; server success is
  authoritative.
- Existing character-not-found and request error behavior remains unchanged.

## Testing

Tests protect observable behavior rather than implementation-only calls or
broad HTML snapshots:

- Character route parsing accepts the `personas` and `memory` tabs while
  retaining the existing default and invalid-tab fallback.
- Persona rendering includes every supplied entry, its editable fields,
  resource IDs, safe escaped content, and a meaningful empty state.
- Memory rendering includes every supplied entry, its editable fields,
  resource IDs, safe escaped content, and a meaningful empty state.
- Persona and memory create, update, and delete actions resolve to the correct
  HTTP methods, paths, IDs, and normalized request bodies.
- Canceling a delete confirmation sends no request and leaves the entry
  visible.
- Focused Admin UI tests are run after each red-green cycle, followed by the
  complete Admin UI check, formatting check, and project build.

## Change Boundaries

- Modify only `packages/admin/main.js`, meaningful tests in
  `packages/admin/test/main.test.mjs`, and this feature's plan/spec documents.
- Do not change NestJS controllers, services, Prisma schema, or database
  migrations because the required contracts already exist.
- Do not refactor unrelated character tabs or Admin styling.
- Do not add bulk operations or drag-and-drop reordering.
