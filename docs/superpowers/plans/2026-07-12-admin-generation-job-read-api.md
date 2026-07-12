# Admin Generation Job Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated, filtered, cursor-paginated generation job listing and single-job lookup.

**Architecture:** Put Prisma reads and job conversion in the existing `GenerationService`; keep `AdminService` as the controller-facing delegation layer. Reuse shared cursor helpers and the existing `jobWithOutput`/`toGenerationJob` representation without schema or lifecycle changes.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29, Supertest 7

## Global Constraints

- Preserve existing uncommitted `packages/admin` changes and exclude them from every commit.
- Add no schema migrations, statuses, actions, UI changes, or unrelated refactors.
- Keep the existing `Generation job not found` and media-type validation contracts.
- Use default page limit 20, maximum 50, newest-first ordering, and filtered cursor validation.
- Execute inline without subagents, per user direction and agent constraints.

---

### Task 1: Add Generation Service List Reads with TDD

**Files:**

- Modify: `src/admin/generation/generation.service.spec.ts`
- Modify: `src/admin/generation/generation.service.ts`

**Interfaces:**

- Consumes: shared `PageInput`, `Page`, `decodeCursor`, `pageFromRows`; Prisma `generationJob`.
- Produces: `GenerationService.listJobs(input: { characterId?: string; status?: string; mediaType?: string } & PageInput): Promise<Page<GenerationJob>>`.

- [ ] **Step 1: Add failing list and validation tests**

Add tests that construct a service with mocked `generationJob.findFirst` and
`findMany`, then assert:

```typescript
const cursor = Buffer.from(
  JSON.stringify({ id: "job-cursor" }),
  "utf8",
).toString("base64url");
const findFirst = jest.fn().mockResolvedValue({ id: "job-cursor" });
const findMany = jest.fn().mockResolvedValue([completedJob, queuedJob]);

await expect(
  service.listJobs({
    characterId: " ai-1 ",
    status: " completed ",
    mediaType: " image ",
    cursor,
    limit: 1,
  }),
).resolves.toEqual({
  items: [expectedCompletedJob],
  nextCursor: expect.any(String),
});
expect(findFirst).toHaveBeenCalledWith({
  where: {
    id: "job-cursor",
    characterId: "ai-1",
    status: "completed",
    mediaType: "image",
  },
  select: { id: true },
});
expect(findMany).toHaveBeenCalledWith({
  where: { characterId: "ai-1", status: "completed", mediaType: "image" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 2,
  cursor: { id: "job-cursor" },
  skip: 1,
  include: { outputMedia: true },
});
```

Use concrete jobs with `createdAt`/`updatedAt` dates and completed output media
so the expected item proves ISO conversion and optional media metadata.

Add three separate error tests:

```typescript
await expect(
  service.listJobs({ characterId: "ai-1", cursor, limit: 20 }),
).rejects.toThrow("Invalid cursor");

await expect(service.listJobs({ status: "failed", limit: 20 })).rejects.toThrow(
  "Generation job status must be queued, running, or completed",
);

await expect(
  service.listJobs({ mediaType: "audio", limit: 20 }),
).rejects.toThrow("Generation media type must be image or video");
```

- [ ] **Step 2: Verify RED**

Run: `npx jest --watchman=false src/admin/generation/generation.service.spec.ts --runInBand`

Expected: TypeScript `TS2339` because `GenerationService.listJobs` does not exist.

- [ ] **Step 3: Add shared page imports and the minimal list implementation**

Add:

```typescript
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
```

Add this public method after the constructor:

```typescript
async listJobs(
  input: {
    characterId?: string;
    status?: string;
    mediaType?: string;
  } & PageInput,
): Promise<Page<GenerationJob>> {
  const characterId = input.characterId?.trim();
  const status = this.parseOptionalStatus(input.status);
  const mediaType = this.parseOptionalMediaType(input.mediaType);
  const where = {
    ...(characterId ? { characterId } : {}),
    ...(status ? { status } : {}),
    ...(mediaType ? { mediaType } : {}),
  };
  const cursorId = decodeCursor(input.cursor);
  if (
    cursorId &&
    !(await this.prisma.generationJob.findFirst({
      where: { id: cursorId, ...where },
      select: { id: true },
    }))
  ) {
    throw new BadRequestException("Invalid cursor");
  }

  const jobs = await this.prisma.generationJob.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    include: this.jobWithOutput,
  });
  return pageFromRows(
    jobs.map((job) => this.toGenerationJob(job as PrismaGenerationJob)),
    input.limit,
  );
}
```

Add these private parsers before `toGenerationJob`:

```typescript
private parseOptionalStatus(status?: string): JobStatus | undefined {
  const value = status?.trim();
  if (!value) return undefined;
  if (value === "queued" || value === "running" || value === "completed") {
    return value;
  }
  throw new BadRequestException(
    "Generation job status must be queued, running, or completed",
  );
}

private parseOptionalMediaType(mediaType?: string): MediaType | undefined {
  const value = mediaType?.trim();
  if (!value) return undefined;
  if (value === "image" || value === "video") return value;
  throw new BadRequestException("Generation media type must be image or video");
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npx jest --watchman=false src/admin/generation/generation.service.spec.ts --runInBand`

Expected: all generation service tests pass.

### Task 2: Expose Generation Service Detail Reads with TDD

**Files:**

- Modify: `src/admin/generation/generation.service.spec.ts`
- Modify: `src/admin/generation/generation.service.ts`

**Interfaces:**

- Consumes: existing `jobWithOutput` and `toGenerationJob`.
- Produces: `GenerationService.getJob(jobId: string): Promise<GenerationJob>`.

- [ ] **Step 1: Add failing success and missing-detail tests**

Add tests with `generationJob.findUnique` returning a concrete queued job and
`null`, respectively:

```typescript
await expect(service.getJob("job-1")).resolves.toEqual({
  id: "job-1",
  characterId: "ai-1",
  mediaType: "video",
  prompt: "city reel",
  status: "queued",
  createdAt: createdAt.toISOString(),
  updatedAt: createdAt.toISOString(),
});
expect(findUnique).toHaveBeenCalledWith({
  where: { id: "job-1" },
  include: { outputMedia: true },
});

await expect(service.getJob("missing-job")).rejects.toThrow(
  "Generation job not found",
);
```

- [ ] **Step 2: Verify RED**

Run: `npx jest --watchman=false src/admin/generation/generation.service.spec.ts --runInBand`

Expected: TypeScript `TS2339` because `getJob` is private/nonexistent publicly.

- [ ] **Step 3: Rename the existing private lookup and update lifecycle callers**

Rename:

```typescript
private async findJob(jobId: string): Promise<GenerationJob>
```

to:

```typescript
async getJob(jobId: string): Promise<GenerationJob>
```

Replace the three calls in `startJob`, `retryJob`, and `completeJob` from
`this.findJob(...)` to `this.getJob(...)`. Keep the lookup body unchanged.

- [ ] **Step 4: Verify GREEN and lifecycle regression safety**

Run: `npx jest --watchman=false src/admin/generation/generation.service.spec.ts --runInBand`

Expected: detail tests and all existing enqueue/start/complete/retry tests pass.

### Task 3: Add Admin Service Delegation with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Consumes: `GenerationService.listJobs` and `GenerationService.getJob`.
- Produces: `AdminService.listGenerationJobs` and `AdminService.getGenerationJob`.

- [ ] **Step 1: Add a failing delegation test**

```typescript
it("delegates generation job reads without recording action logs", async () => {
  const listJobs = jest.fn().mockResolvedValue({ items: [] });
  const getJob = jest.fn().mockResolvedValue({ id: "job-1" });
  const service = new (
    AdminService as new (...args: unknown[]) => AdminService
  )(
    {},
    { listJobs, getJob },
    { startUpload: jest.fn(), confirmUpload: jest.fn() },
  );

  await expect(
    service.listGenerationJobs({ status: "queued", limit: 20 }),
  ).resolves.toEqual({ items: [] });
  await expect(service.getGenerationJob("job-1")).resolves.toEqual({
    id: "job-1",
  });
  expect(listJobs).toHaveBeenCalledWith({ status: "queued", limit: 20 });
  expect(getJob).toHaveBeenCalledWith("job-1");
});
```

- [ ] **Step 2: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: `TS2339` for both missing admin service methods.

- [ ] **Step 3: Add minimal delegation methods before enqueue**

```typescript
listGenerationJobs(input: Parameters<GenerationService["listJobs"]>[0]) {
  return this.generationService.listJobs(input);
}

getGenerationJob(jobId: string) {
  return this.generationService.getJob(jobId);
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 4: Add HTTP Routes with TDD

**Files:**

- Modify: `src/admin/admin.controller.spec.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**

- Consumes: admin service delegation and `parsePageQuery`.
- Produces: `GET /api/generation/jobs` and `GET /api/generation/jobs/:id`.

- [ ] **Step 1: Extend controller mocks and add failing HTTP tests**

Add `listGenerationJobs` and `getGenerationJob` Jest mocks to the existing
controller spec's service value and reset them in `beforeEach`.

```typescript
it("forwards generation job list filters and pagination", async () => {
  listGenerationJobs.mockResolvedValue({ items: [] });

  await request(app.getHttpServer())
    .get("/api/generation/jobs")
    .query({
      characterId: "ai-1",
      status: "queued",
      mediaType: "image",
      limit: "9",
    })
    .expect(200)
    .expect({ items: [] });

  expect(listGenerationJobs).toHaveBeenCalledWith({
    characterId: "ai-1",
    status: "queued",
    mediaType: "image",
    limit: 9,
  });
});

it("forwards the generation job detail ID", async () => {
  getGenerationJob.mockResolvedValue({ id: "job-1" });

  await request(app.getHttpServer())
    .get("/api/generation/jobs/job-1")
    .expect(200)
    .expect({ id: "job-1" });

  expect(getGenerationJob).toHaveBeenCalledWith("job-1");
});
```

- [ ] **Step 2: Verify RED outside the sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts --runInBand`

Expected: both new requests return HTTP 404 because GET routes are absent.

- [ ] **Step 3: Add controller methods immediately before generation enqueue**

```typescript
@Get("generation/jobs")
listGenerationJobs(
  @Query("characterId") characterId?: string,
  @Query("status") status?: string,
  @Query("mediaType") mediaType?: string,
  @Query("cursor") cursor?: string,
  @Query("limit") limit?: string,
) {
  return this.adminService.listGenerationJobs({
    characterId,
    status,
    mediaType,
    ...parsePageQuery(cursor, limit),
  });
}

@Get("generation/jobs/:id")
getGenerationJob(@Param("id") jobId: string) {
  return this.adminService.getGenerationJob(jobId);
}
```

- [ ] **Step 4: Verify GREEN outside the sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts src/admin/admin.service.spec.ts src/admin/generation/generation.service.spec.ts --runInBand`

Expected: all three suites pass.

### Task 5: Verify and Commit

**Files:**

- Verify: `src/admin/generation/generation.service.spec.ts`
- Verify: `src/admin/generation/generation.service.ts`
- Verify: `src/admin/admin.service.spec.ts`
- Verify: `src/admin/admin.service.ts`
- Verify: `src/admin/admin.controller.spec.ts`
- Verify: `src/admin/admin.controller.ts`

**Interfaces:**

- Produces: one isolated implementation commit after the prior documentation and plan commits.

- [ ] **Step 1: Run targeted formatting**

Run: `npx prettier --check src/admin/generation/generation.service.spec.ts src/admin/generation/generation.service.ts src/admin/admin.service.spec.ts src/admin/admin.service.ts src/admin/admin.controller.spec.ts src/admin/admin.controller.ts`

Expected: exit 0.

- [ ] **Step 2: Run complete verification**

Run outside sandbox where needed:

```bash
npm run test -- --runInBand
npm run lint
npm run build
```

Expected: all tests pass; lint and build exit 0.

- [ ] **Step 3: Audit and stage only six implementation files**

```bash
git status --short
git diff --check
git add src/admin/generation/generation.service.spec.ts \
  src/admin/generation/generation.service.ts \
  src/admin/admin.service.spec.ts \
  src/admin/admin.service.ts \
  src/admin/admin.controller.spec.ts \
  src/admin/admin.controller.ts
git diff --cached --name-only
```

Expected: cached paths are exactly those six; no `packages/admin` path appears.

- [ ] **Step 4: Commit and confirm isolation**

Run:

```bash
git diff --cached --check
git commit -m "feat: add admin generation job read APIs"
git status --short
git show --stat --oneline --summary HEAD
```

Expected: commit succeeds and only the pre-existing four `packages/admin`
modifications remain in the worktree.
