# Codex Adapter

- Treat `AGENTS.md` and `.codex/pave/config.md` as the shared contract; do not
  repeat their workflow rules in prompts or plans.
- Give GPT models the goal, relevant context, hard constraints, approval
  boundaries, success criteria, and required evidence. Avoid prescribing
  step-by-step reasoning unless the task genuinely requires that procedure.
- Keep model choice and reasoning effort in Codex runtime configuration. Do not
  bake current GPT model names into repository instructions or ask the model to
  "think harder" in prose.
- Use Codex-native tools and bounded subagents when useful. Do not copy Claude
  Code model aliases, permission modes, or agent-discovery instructions.
- Prefer `$pave:pave` and use PAVE templates when the corresponding artifact is
  useful.
