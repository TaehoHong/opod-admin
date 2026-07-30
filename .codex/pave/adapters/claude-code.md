# Claude Code Adapter

- Follow `AGENTS.md` and `.codex/pave/config.md`; the shared PAVE source of truth stays in `.codex/pave/`.
- Keep PAVE artifacts in the existing `.codex/pave/` paths; do not rename them to Claude-specific paths.
- Use `/pave` from `.claude/commands/pave.md` for PAVE workflows when available.
- Use `.claude/agents/` only as the Claude Code adapter copy for bounded specialist subagent discovery.
- Keep Claude model selection and permission behavior in Claude Code runtime
  configuration. Do not copy GPT model names, reasoning-effort settings, or
  Codex-specific prompt tuning into repository instructions.
- Keep specialist briefs explicit about scope, inputs, outputs, and tool
  boundaries without repeating the shared PAVE workflow.
- Use Claude Code tools as equivalents for planning, editing, review, and verification, while preserving PAVE plan and report formats.
- If Claude-specific guidance conflicts with the shared PAVE contract, follow the shared contract and call out the conflict.
