# Hansoi Reference Database Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload 12 numbered Hansoi PNG files to S3 and attach all 12 to the remote `soi_film` visual profile.

**Architecture:** A temporary Node.js importer reads and validates the PNG files, uses the project's installed AWS SDK to upload deterministic S3 keys, and uses `pg` to perform all database writes in one transaction. A dry run precedes the mutation, and independent S3 and SQL checks verify the result.

**Tech Stack:** Node.js, `@aws-sdk/client-s3`, `pg`, PostgreSQL 16, Amazon S3

## Global Constraints

- Do not modify the application's five-reference limit or admin UI.
- Target only character `019f421d-0311-730a-877c-31e29c5d71ac` with `public_id = soi_film`.
- Preserve file order `hansoi_01.png` through `hansoi_12.png` as sort orders 10 through 120.
- Do not print database or AWS credentials.
- Use deterministic storage keys and reject conflicting existing objects.

---

### Task 1: Build and dry-run the temporary importer

**Files:**
- Create temporarily: `/private/tmp/import-hansoi-references.mjs`
- Read: `/Users/hongtaeho/Library/Mobile Documents/com~apple~CloudDocs/hansoi_references/hansoi_01.png` through `hansoi_12.png`

**Interfaces:**
- Consumes: `REMOTE_DATABASE_URL`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_PUBLIC_BASE_URL` environment variables
- Produces: dry-run JSON containing exactly 12 validated files, SHA-256 values, dimensions, storage keys, and the verified character ID

- [ ] **Step 1: Create a temporary importer with explicit validation**

The script must sort files numerically, require exactly 12 PNGs, validate the PNG signature and IHDR dimensions, compute SHA-256, verify the exact remote character ID and public ID, check for conflicting S3 objects by deterministic key, and exit before mutation unless invoked with `--apply`.

- [ ] **Step 2: Run the dry run**

Run from `/Users/hongtaeho/opod/opod-admin` with `.env` loaded and `REMOTE_DATABASE_URL` set to the user-provided remote connection string:

```bash
node --env-file=.env /private/tmp/import-hansoi-references.mjs --dry-run
```

Expected: exit 0, `fileCount: 12`, character `soi_film`, no conflicting S3 keys, and no database writes.

### Task 2: Upload and attach all references

**Files:**
- Execute temporarily: `/private/tmp/import-hansoi-references.mjs`

**Interfaces:**
- Consumes: validated file metadata from Task 1
- Produces: 12 S3 objects, 12 `opod.media` rows, one visual profile, and 12 ordered `opod.character_visual_profile_references` rows

- [ ] **Step 1: Execute the importer in apply mode**

```bash
node --env-file=.env /private/tmp/import-hansoi-references.mjs --apply
```

Expected: exit 0 with `uploaded: 12`, `mediaRows: 12`, and `referenceRows: 12`. Database writes run inside one transaction after all S3 uploads succeed.

- [ ] **Step 2: Verify remote database state independently**

Query the remote database for the target character and require exactly 12 joined references with sort orders `10,20,30,40,50,60,70,80,90,100,110,120`, non-null `uploaded_at`, PNG content type, and the expected reference storage prefix.

- [ ] **Step 3: Verify S3 objects independently**

Issue `HeadObject` for every storage key and require content length, `image/png`, and stored SHA-256 metadata to match the local file.

- [ ] **Step 4: Confirm source code remained unchanged**

```bash
git status --short
git diff -- src/characters/visual-profile.service.ts packages/admin/main.js
```

Expected: no source diff; only pre-existing untracked `.superpowers/brainstorm` files may remain.
