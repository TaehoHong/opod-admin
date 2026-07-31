# Media Generation Trace Handoff

Status: implementation complete, focused verification passed, full verification
remaining

Last updated: 2026-07-31

## Goal

Improve the post-generation Agent's output quality and physical plausibility by
making the structured shot plan and the actual image-provider execution
auditable in draft review.

## Confirmed Product Decision

- A plan/execution mismatch is an operator-facing warning.
- It must not block image generation or draft approval.
- Approval continues to require only a `needs_review` draft and one selected
  output for every cut.
- A mismatch does not trigger automatic regeneration.

## Implemented in This Slice

1. `GenerationWorkerService` stores the actual route and resolved reference
   media IDs in `paramsJson._shot.execution` in the same update that stores the
   provider request ID.
2. A changed runtime provider is logged and executed instead of permanently
   failing only because it differs from `_shot.targetModelId`.
3. `GET /drafts/:id` returns `generationTrace` with:
   - capture setup and character visibility;
   - planned route, target model and references;
   - actual route, provider and resolved references;
   - `matchesPlan` when comparable plan data exists.
4. Missing media records remain visible as `available: false`; their IDs are
   not silently dropped.
5. Draft review shows the plan and actual execution side by side. A mismatch
   displays a warning that explicitly says approval remains possible.
6. Legacy jobs without an execution snapshot show that execution details are
   unavailable.
7. Existing `references` and `provider` response fields remain for
   compatibility. No database schema or endpoint was added.

## Verification Evidence

Passed:

- `npm run test -- src/worker/generation-worker.service.spec.ts src/admin/drafts/drafts.service.spec.ts --runInBand`
  - 2 suites, 39 tests
- `npm --prefix packages/admin run test -- DraftDetailPanel.test.tsx`
  - 1 suite, 1 test
- `npm --prefix packages/admin run typecheck`
- `npm run format`
- `npm run lint`
- `git diff --check`

The focused UI regression proves that a mismatch warning is visible while the
approval button remains enabled when every cut has a selected output.

Full `npm run admin:check` did not complete green. The new draft trace test
passed, but the run ended with four failures outside the drafts feature:

- `CharactersPage.test.tsx`: create-character timeout and an unhandled
  `/characters/character-2` request.
- `CreditsPage.test.tsx`: credit-grant timeout.
- `GenerationPage.test.tsx`: two timeout/request-observation failures.

An earlier parallel run also showed failures in the locally modified
`PostsPage.tsx` area. That user-owned file is intentionally not included in
this commit.

## Remaining Work

1. Re-run the failing frontend specs individually to distinguish existing
   flakiness from current branch regressions. Do not modify unrelated screens
   as part of this feature without a separate scope decision.
2. Re-run `npm run admin:check`.
3. Run the full backend suite: `npm run test -- --runInBand`.
4. Run `npm run build`.
5. Run `npm run test:e2e` when Docker is available because the draft response
   contract changed.
6. Run the PAVE doctor and final diff review.
7. If all declared checks pass, update this status and proceed with the normal
   review/deployment flow.

## Review Focus

- `src/worker/generation-worker.service.ts`: provider submission snapshot and
  non-blocking model drift.
- `src/admin/drafts/drafts.service.ts`: trace comparison and unavailable media
  representation.
- `packages/admin/src/features/drafts/ShotCard.tsx`: warning-only review UX.

## Known Boundaries

- Existing provider requests that predate this change are not backfilled.
- A resumed legacy provider request without `_shot.execution` remains marked as
  having no execution details; current references are not falsely recorded as
  historical facts.
- Location continuity, outfit continuity, approval-time selection freezing and
  automatic regeneration remain separate follow-up work.
