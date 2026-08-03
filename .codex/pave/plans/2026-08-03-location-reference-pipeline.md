# Location reference pipeline

Status: implemented and verified

## Approved behavior

- A location may be global (`character_id IS NULL`) or character-specific.
- A post draft may select one location.
- Identity references remain owned by `CharacterVisualProfile`.
- Environment references belong to a location and never satisfy the identity-reference requirement.
- Character-hidden shots may use environment references without identity references.
- The public post API remains unchanged.

## Implementation slices

- [x] Add canonical `CharacterLocation`, `CharacterLocationReference`, and nullable `PostDraft.locationId` schema plus migration; mirror the schema in admin.
- [x] Pass available global and character-specific locations to the content planner and persist the selected location and typed shot references.
- [x] Add the canonical environment prompt to image prompt construction and submit selected environment references plus location negative prompts to the image provider.
- [x] Complete full repository verification and review the final diff.
- [x] Generate and upload five Seorin gym environment references, register the
      character-specific location in the development database, and verify the
      planner lookup.
- [x] Deploy the admin pipeline and verify development health.

## Verification

- `npm run schema:check`
- focused planner, prompt-builder, draft-worker, and generation-worker specs
- `npm run lint`
- `npm run test`
- `npm run build`
- backend `npm run test` and `npm run build`
- admin and backend `npm run test:e2e`
- development DB planner lookup: location visible, five uploaded references
- deployed health: admin `200`, backend `healthy`

## Out of scope

- Admin CRUD UI for editing locations after registration.
- Production deployment outside the current `dev-api-run-taeho.com` target.

## Deployment note

- The additive migration was applied to the development database.
- The new admin image was deployed successfully.
- The backend application image was restored to its previous version because
  the server does not currently provide the newly required
  `GOOGLE_OAUTH_CLIENT_ID`; the applied migration remains backward-compatible.
