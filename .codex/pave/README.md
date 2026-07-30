# PAVE Runtime

This repository uses PAVE: **Plan, Approve, Verify, Execute**.

PAVE keeps AI-assisted development aligned with explicit product decisions,
small maintainable changes and fresh verification.

Korean documentation: [README.kr.md](README.kr.md)

## Quick Use

In Codex:

```text
$pave:pave implement this feature
$pave:pave find and fix this bug
$pave:pave review the current changes
$pave:pave continue the previous task
```

In Claude Code:

```text
/pave implement this feature
/pave find and fix this bug
/pave review the current changes
/pave continue the previous task
```

## Workflow

1. Read `AGENTS.md`, `CLAUDE.md`, `.codex/pave/config.md` and the matching
   adapter.
2. For code work, read `docs/07-codebase-guide.md` and inspect only the target,
   direct dependencies, relevant tests and current canonical examples first.
3. Ask about unresolved choices only when they materially change product
   behavior, security, data, cost, permissions, contracts or architecture.
   Decide minor reversible implementation details within approved rules.
4. Use the fast path only for an explicitly requested, low-risk change within
   its hard size limits and with cheap narrow verification.
5. Otherwise create a useful plan and ask once for consolidated approval
   immediately before code or test edits.
6. Add only tests that protect meaningful observable behavior.
7. Implement, review and run fresh risk-based verification.
8. Report the outcome, verification evidence and residual risk.

Project initialization is limited to repository runtime and project-wide
direction. Feature-specific behavior is decided when that feature is
implemented.

## Codex vs Claude Code

| Topic | Codex | Claude Code |
| --- | --- | --- |
| Command | `$pave:pave ...` | `/pave ...` |
| First file | `AGENTS.md` | `CLAUDE.md`, then `AGENTS.md` |
| Runtime path | `.codex/pave/` | `.codex/pave/` |

## Files

- `config.md`: repository-specific PAVE policy
- `../../docs/07-codebase-guide.md`: current ownership and verification index
- `plans/`: implementation plans when a durable plan is useful
- `reports/`: final or blocked reports when useful
- `templates/`: artifact templates
- `adapters/`: environment-specific guidance

## Health Check

Ask Codex:

```text
$pave:doctor
```

Terminal fallback from the PAVE plugin:

```bash
./scripts/doctor.js <repo-path>
```
