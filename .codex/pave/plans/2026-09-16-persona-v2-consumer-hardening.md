# Persona v2 consumer hardening and Nahee cleanup

Status: complete; Astra final review approved

## Scope

- [x] Return `schemaVersion` consistently from admin persona APIs.
- [x] Normalize `content_style` and `content_guidance` for V3/V4 post inputs and reject conflicting duplicates.
- [x] Preserve and validate persona source schema versions in the agent read path without changing v1 compatibility.
- [x] Apply the approved recoverable Nahee local-data cleanup without generating a post.
- [x] Run focused and declared verification, then obtain an Astra read-only final review.

## Constraints

- No additional DDL or migration changes in this hardening slice; the earlier approved persona-v2 migration remains part of the working tree.
- No post generation or publishing.
- Do not redesign the visual profile; remove only the user-confirmed fixed color and lens defaults.
- Preserve unrelated user changes and existing row IDs.

## Verification

- Admin focused unit/E2E plus lint, build, and relevant full suites.
- Agent focused store/router/integration tests plus the repository `check` command.
- Independent local-DB readback for Nahee active rows, fragments, keywords, canon, and visual profile.
- Final Astra review uses the integrated diff and fresh verification evidence.
