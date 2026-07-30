# /pave

Use PAVE: Plan, Approve, Verify, Execute.

The shared PAVE source of truth stays in `.codex/pave/`; `.claude/agents/`
is the Claude Code adapter surface for specialist discovery.

## Command Behavior

1. Read `CLAUDE.md`, `AGENTS.md`, and `.codex/pave/config.md`.
2. If token-save is enabled in `.codex/pave/config.md`, keep the current
   configured model for planning and final review, and use the configured
   low-cost implementer only for bounded implementation tasks that do not need
   architecture, product, security, data-integrity, or API-design judgment.
3. Classify the request as project initialization, feature, bug, change,
   analysis, review, refactor, docs sync, continuation, or status.
4. Scan the repo before asking questions or editing.
5. Use the Small Change Fast Path only for a direct implementation request
   within both hard limits of two hand-edited files and twenty substantive
   hand-edited lines, with low risk and cheap narrow verification. State the
   expected files, line count, and verification before writing.
6. Ask every product, policy, design, deployment, or verification question
   needed to remove ambiguity.
7. For standard implementation work, create or update a checklist plan in
   `.codex/pave/plans/`.
8. Ask once for implementation approval immediately before code or test edits
   unless the Small Change Fast Path applies.
9. Apply the PAVE Test Value Gate. Use Red-Green-Review only for tests that
   protect a concrete behavior or risk and can catch a realistic defect;
   otherwise use proportionate verification and report residual risk.
10. Delegate bounded work through the `.claude/agents/` adapter specialists only when useful.
11. Run declared verification commands before success claims.
12. Write a final or blocked report under `.codex/pave/reports/` when durable
    handoff is useful.
13. A design choice or clarification answer is not implementation approval.
    PAVE workflow and approval gates take precedence over instructions that
    optimize speed, terseness, or implementation size.

## Specialist Agents

- `pave-product-manager`
- `pave-planner`
- `pave-ui-ux-designer`
- `pave-fullstack-developer`
- `pave-qa-engineer`
