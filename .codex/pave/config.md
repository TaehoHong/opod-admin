# PAVE Config

## Runtime

- Interface: keep one chat session from request to completion when feasible.
- Orchestrator: the main agent owns scope, approval, verification and final
  claims.
- Approval gate: ask once immediately before code or test edits unless the
  PAVE fast path applies.
- Clarification: ask only when an unresolved choice materially changes product
  behavior, security, data, cost, permissions, external contracts or
  architecture.
- Minor reversible implementation details are decided autonomously within
  approved project rules.
- When detailed policy input is required, ask one material decision at a time.
- Project initialization decides project-wide policy only; feature-specific
  details are deferred to that feature's implementation.
- Durable artifacts: `plans/`, `reports/`, project docs and
  `docs/07-codebase-guide.md`.

## Context Retrieval

- Read `docs/07-codebase-guide.md` before broad source discovery.
- Check staleness only for request-relevant entries and evidence paths.
- Inspect the target, direct callers/callees, relevant tests, shared owners and
  canonical examples before expanding.
- Current code overrides stale guide entries.
- Do not treat an approved target architecture as current repository fact.
- Update affected guide entries when ownership, shared structure, canonical
  examples, tests or verification commands change.

## Request Routing

- Project initialization: runtime files, direction docs and declared
  verification commands only; do not implement product features.
- Small change: a direct implementation request within two hand-edited files
  and twenty substantive hand-edited lines may use the fast path when it is
  low risk and has cheap narrow verification.
- Feature/change: plan material behavior and policy first, then apply the Test
  Value Gate.
- Bug: establish root cause before proposing a fix.
- Analysis: inspect and report; do not edit without authorization.
- Review: findings first, severity ordered, with file/line evidence.
- Refactor: preserve behavior and verify with declared commands.
- Docs sync: update from current code evidence and explicit user decisions.
- Continuation: resume from the newest relevant plan or conversation state.

## Execution Modes

- `go`: execute the next approved checklist item.
- `batch`: execute an approved phase.
- `fast`: execute an eligible low-risk small change.
- `status`: report progress, blockers and verification.
- Token-save: disabled.
- Low-cost implementer: not declared.

## Test Value Gate

- Every test must protect an observable behavior, API contract, permission,
  data state, error path or business rule.
- Do not add coverage-only, framework-behavior, private-implementation or
  duplicate tests.
- Keep the default feedback path fast and reserve Docker-backed E2E for
  boundaries that need a real database.

## Git and User Changes

- Preserve unrelated user changes in a dirty worktree.
- Never bypass `.gitignore` or run `git add -f`.
- Check uncertain new paths with `git check-ignore -v --no-index` before
  staging.

## Subagents

Allowed specialist briefs: product manager, planner, UI/UX designer, fullstack
developer and QA engineer. Use them only when the user or applicable
instructions authorize delegation. The main agent owns final claims.
