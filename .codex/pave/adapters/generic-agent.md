# Generic Agent Adapter

1. Read `AGENTS.md`, `.codex/pave/config.md` and
   `docs/07-codebase-guide.md`.
2. Inspect the target, direct dependencies, relevant tests and current
   canonical examples before broad discovery.
3. Ask only about unresolved choices that materially affect product behavior,
   security, data, cost, permissions, contracts or architecture. Decide minor
   reversible details within approved project rules.
4. Use the fast path only for an explicitly requested low-risk change within
   two hand-edited files and twenty substantive hand-edited lines.
5. Otherwise create a useful plan and ask once for implementation approval
   immediately before code or test edits.
6. Add tests only when they protect concrete observable behavior or risk.
7. Preserve unrelated user changes and verify before reporting success.
