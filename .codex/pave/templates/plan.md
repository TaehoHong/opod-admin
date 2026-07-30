# Plan: <task name>

## Goal

<User-visible outcome.>

## Success Criteria

- <Observable outcome>
- <Declared verification command that must pass>

## Constraints

- Product/policy ambiguity: <questions asked and resolved>
- Out of scope: <explicit non-goals>
- Test Value Gate: each proposed test names the behavior or risk it protects
  and the realistic defect that would make it fail; otherwise use
  proportionate verification and record residual risk

## Current Context

- <Repo facts discovered during scan>

## Execution Mode

- Approval: one consolidated approval required immediately before code/test edits
- Re-approval required only for scope change, destructive action, new ambiguity, credentials, permissions, or invalidated verification strategy
- Default: `go`

## Checklist

### [ ] 1. <Vertical Slice: actor outcome>

- Flow: <entry point -> shared rule owner -> observable result>
- Files and symbols: <exact implementation boundary>
- Verification: <valuable test and protected risk, or non-test command and residual risk>
- Human review focus: <key file, decision, or residual risk>

### [ ] 2. <Vertical Slice: next actor outcome>

- Flow: <entry point -> shared rule owner -> observable result>
- Files and symbols: <exact implementation boundary>
- Verification: <valuable test and protected risk, or non-test command and residual risk>
- Human review focus: <key file, decision, or residual risk>

## Final Verification

- Format: `<command or not declared>`
- Lint: `<command or not declared>`
- Unit tests: `<command or not declared>`
- Integration or E2E tests: `<command or not declared>`
- Build or typecheck: `<command or not declared>`
