# Admin Stepwise Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only four-step image workflow that pauses before provider submission, lets an operator edit the compiled prompt, generates 1–4 candidates, and requires explicit final selection while preserving regeneration history.

**Architecture:** Keep `GenerationJob` as the unit of one generation round. Add a non-claimable `draft` status plus persisted input prompt and optional per-job candidate count, then use `originJobId` for later rounds and `outputMediaId` to distinguish candidate review from final selection. The existing worker, output table, provider adapters, and static admin SPA remain in place.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7/PostgreSQL, Jest/Supertest, vanilla JavaScript admin SPA, Node test runner, CSS.

## Global Constraints

- The workflow is image-only: request input → final prompt review → candidate generation → candidate selection.
- Candidate count is an integer from 1 through 4 for stepwise jobs.
- A `draft` job must never be claimed or submitted to a provider.
- Existing jobs with `candidateCount = null` continue using `WORKER_CANDIDATE_COUNT`.
- Generated candidates remain stored; selection does not add the image to character references.
- Manual regeneration creates a new row linked through `originJobId`; automatic retries remain on the same row through `attemptCount`.
- `DRAFT_SCHEDULER_ENABLED` defaults to `false`; `WORKER_ENABLED` remains enabled for confirmed jobs.
- The canonical Prisma schema is `/Users/hongtaeho/opod/opod-service-backend/prisma/schema.prisma`; mirror it into admin only after changing the canonical copy.
- Do not redesign post drafts, video generation, captions, hashtags, or publishing.

---

### Task 1: Extend and synchronize the generation-job schema

**Files:**
- Modify: `/Users/hongtaeho/opod/opod-service-backend/prisma/schema.prisma`
- Modify: `/Users/hongtaeho/opod/opod-admin/prisma/schema.prisma`

**Interfaces:**
- Produces: `GenerationJobStatus.draft`
- Produces: `GenerationJob.inputPrompt: string | null`
- Produces: `GenerationJob.candidateCount: number | null`
- Preserves: `null` candidate count means “use worker configuration”

- [ ] **Step 1: Add the canonical enum value and fields**

In the service-backend schema, make the enum and model contain:

```prisma
enum GenerationJobStatus {
  draft
  queued
  running
  completed
  failed

  @@map("generation_job_status")
  @@schema("opod")
}

model GenerationJob {
  // existing fields remain unchanged
  prompt         String
  inputPrompt    String? @map("input_prompt")
  candidateCount Int?    @map("candidate_count")
}
```

- [ ] **Step 2: Verify the admin mirror detects the canonical change**

Run from `/Users/hongtaeho/opod/opod-admin`:

```bash
npm run schema:check
```

Expected: FAIL because the canonical schema now contains the three additions and the admin mirror does not.

- [ ] **Step 3: Mirror the exact enum and fields into the admin schema**

Apply the same Prisma declarations to `/Users/hongtaeho/opod/opod-admin/prisma/schema.prisma`. Do not change unrelated models or formatting.

- [ ] **Step 4: Generate both Prisma clients and verify schema equality**

Run:

```bash
cd /Users/hongtaeho/opod/opod-service-backend && npm run db:generate
cd /Users/hongtaeho/opod/opod-admin && npm run db:generate
cd /Users/hongtaeho/opod/opod-admin && npm run schema:check
```

Expected: both generate commands exit 0; schema check prints the success message and exits 0.

- [ ] **Step 5: Commit the canonical and mirrored schema changes separately**

```bash
cd /Users/hongtaeho/opod/opod-service-backend
git add prisma/schema.prisma
git commit -m "feat: extend generation jobs for staged images"

cd /Users/hongtaeho/opod/opod-admin
git add prisma/schema.prisma
git commit -m "feat: sync staged generation job schema"
```

### Task 2: Share the image prompt compiler

**Files:**
- Create: `/Users/hongtaeho/opod/opod-admin/src/worker/image-prompt.ts`
- Create: `/Users/hongtaeho/opod/opod-admin/src/worker/image-prompt.spec.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/worker/draft-worker.service.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/worker/draft-worker.service.spec.ts`

**Interfaces:**
- Produces: `compileImagePrompt(profile, request): string`
- Consumes later: `GenerationService.createImageDraft()`

- [ ] **Step 1: Write the failing compiler test**

```ts
import { compileImagePrompt } from "./image-prompt";

describe("compileImagePrompt", () => {
  it("places appearance before the request and style after it", () => {
    expect(
      compileImagePrompt(
        { appearancePrompt: "same face", stylePrompt: "film grain" },
        "walking in Seongsu",
      ),
    ).toBe("same face, walking in Seongsu, film grain");
    expect(compileImagePrompt(null, "walking in Seongsu")).toBe(
      "walking in Seongsu",
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run:

```bash
npm test -- --runInBand src/worker/image-prompt.spec.ts
```

Expected: FAIL because `./image-prompt` does not exist.

- [ ] **Step 3: Implement the shared compiler**

```ts
export function compileImagePrompt(
  profile: { appearancePrompt: string; stylePrompt: string } | null,
  request: string,
): string {
  return [profile?.appearancePrompt ?? "", request, profile?.stylePrompt ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}
```

Import this function in `draft-worker.service.ts`, replace `compileShotPrompt(...)` with `compileImagePrompt(...)`, and remove the old local function. Update the existing helper test to import and assert `compileImagePrompt` from the new file.

- [ ] **Step 4: Run both affected test files**

```bash
npm test -- --runInBand src/worker/image-prompt.spec.ts src/worker/draft-worker.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the prompt boundary**

```bash
git add src/worker/image-prompt.ts src/worker/image-prompt.spec.ts src/worker/draft-worker.service.ts src/worker/draft-worker.service.spec.ts
git commit -m "refactor: share image prompt compilation"
```

### Task 3: Add stepwise generation service behavior

**Files:**
- Modify: `/Users/hongtaeho/opod/opod-admin/src/admin/generation/generation.service.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/admin/generation/generation.service.spec.ts`

**Interfaces:**
- Produces: `createImageDraft({ characterId, inputPrompt, candidateCount })`
- Produces: `updateImageDraft(jobId, { prompt, candidateCount })`
- Produces: `confirmImageDraft(jobId)`
- Produces: `selectOutput(jobId, mediaId)`
- Produces: `regenerateImageJob(jobId)`
- Extends job response with `inputPrompt`, `candidateCount`, `outputMediaId`, and `generationContext`

- [ ] **Step 1: Write failing tests for draft creation and validation**

Add focused tests that construct `GenerationService` with mocked `character.findUnique` and `generationJob.create` methods:

```ts
it("creates a non-claimable image draft with a compiled prompt", async () => {
  character.findUnique.mockResolvedValue({
    id: "ai-1",
    visualProfile: {
      appearancePrompt: "same face",
      stylePrompt: "film grain",
      negativePrompt: "blurry",
      referenceMedia: [{ media: { uploadedAt: new Date() } }],
    },
  });
  generationJob.create.mockResolvedValue(job({
    status: "draft",
    inputPrompt: "walking in Seongsu",
    prompt: "same face, walking in Seongsu, film grain",
    candidateCount: 3,
  }));

  await expect(service.createImageDraft({
    characterId: "ai-1",
    inputPrompt: " walking in Seongsu ",
    candidateCount: 3,
  })).resolves.toMatchObject({ status: "draft", candidateCount: 3 });

  expect(generationJob.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      mediaType: "image",
      status: "draft",
      inputPrompt: "walking in Seongsu",
      prompt: "same face, walking in Seongsu, film grain",
      candidateCount: 3,
    }),
  }));
});

it.each([0, 5, 1.5])("rejects candidateCount %p", async (candidateCount) => {
  await expect(service.createImageDraft({
    characterId: "ai-1",
    inputPrompt: "portrait",
    candidateCount,
  })).rejects.toThrow("Candidate count must be an integer from 1 to 4");
});
```

- [ ] **Step 2: Write failing state-transition and selection tests**

Cover these observable contracts:

```ts
await expect(service.updateImageDraft("job-1", {
  prompt: "edited prompt",
  candidateCount: 4,
})).resolves.toMatchObject({ status: "draft", prompt: "edited prompt" });

await expect(service.confirmImageDraft("job-1")).resolves.toMatchObject({
  status: "queued",
});

await expect(service.selectOutput("job-1", "media-2")).resolves.toMatchObject({
  outputMediaId: "media-2",
});

await expect(service.regenerateImageJob("job-1")).resolves.toMatchObject({
  status: "draft",
  originJobId: "job-1",
  prompt: "edited prompt",
  candidateCount: 4,
});
```

Assert that update uses `where: { id, status: "draft" }`; confirm uses `where: { id, status: "draft" }` and `data: { status: "queued" }`; selection checks a `GenerationJobOutput` belonging to the completed job and updates all selection flags plus `outputMediaId` and the action log inside one transaction. Also assert that failed or completed jobs cannot be edited and foreign media IDs cannot be selected.

- [ ] **Step 3: Run the service tests and verify the missing methods fail**

```bash
npm test -- --runInBand src/admin/generation/generation.service.spec.ts
```

Expected: FAIL with missing method/type errors for the new workflow.

- [ ] **Step 4: Implement the response shape and draft methods**

Extend `JobStatus` with `draft`, and extend `GenerationJob`/`PrismaGenerationJob` with:

```ts
inputPrompt?: string;
candidateCount?: number;
outputMediaId?: string;
generationContext?: {
  negativePrompt: string;
  referenceImageCount: number;
  route: "t2i" | "edit";
};
```

Use `compileImagePrompt` in `createImageDraft`. Read the character visual profile once, count only references whose media has `uploadedAt`, and return `route: "edit"` when that count is positive. Keep `enqueueJob` backward compatible by leaving `inputPrompt` and `candidateCount` unset.

Extend `jobWithOutputs` so detail reads include the character visual profile's `negativePrompt` and reference media `uploadedAt` values. Map those values into `generationContext`, expose the scalar `outputMediaId`, and add `draft` to `parseOptionalStatus` and its validation message. List responses need `outputMediaId` but do not need the heavier `generationContext` relation.

Implement candidate validation as one private function:

```ts
private parseCandidateCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new BadRequestException(
      "Candidate count must be an integer from 1 to 4",
    );
  }
  return value;
}
```

Implement update and confirm with conditional `updateMany`. If confirm affects zero rows, fetch the job: return it when already queued/running/completed/failed, but reject an unknown transition. This makes double clicks idempotent without submitting twice.

- [ ] **Step 5: Implement transactional output selection and regeneration**

`selectOutput` must first fetch a candidate with:

```ts
where: {
  jobId,
  mediaId,
  job: { status: "completed" },
}
```

Use `findFirst({ where: { jobId, mediaId, job: { status: "completed" } } })`; the schema does not define a `(jobId, mediaId)` compound unique key. Then run this transaction:

```ts
await tx.generationJobOutput.updateMany({
  where: { jobId },
  data: { selected: false },
});
await tx.generationJobOutput.updateMany({
  where: { jobId, mediaId },
  data: { selected: true },
});
await tx.generationJob.update({
  where: { id: jobId },
  data: { outputMediaId: mediaId },
});
await tx.characterActionLog.create({
  data: {
    characterId: job.characterId,
    actionType: "GENERATION_OUTPUT_SELECTED",
    targetTable: "generation_jobs",
    targetId: jobId,
    reason: `selected generation output ${mediaId}`,
  },
});
```

`regenerateImageJob` accepts only image jobs in `completed` or `failed`, then creates a new `draft` row copying `characterId`, `inputPrompt ?? prompt`, `prompt`, `candidateCount`, `paramsJson`, and setting `originJobId` to the source job ID.

- [ ] **Step 6: Run the focused service suite**

```bash
npm test -- --runInBand src/admin/generation/generation.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the service state machine**

```bash
git add src/admin/generation/generation.service.ts src/admin/generation/generation.service.spec.ts
git commit -m "feat: add stepwise image generation state machine"
```

### Task 4: Expose the stepwise HTTP contract

**Files:**
- Create: `/Users/hongtaeho/opod/opod-admin/src/admin/dto/create-image-generation-draft.dto.ts`
- Create: `/Users/hongtaeho/opod/opod-admin/src/admin/dto/update-image-generation-draft.dto.ts`
- Create: `/Users/hongtaeho/opod/opod-admin/src/admin/dto/select-generation-output.dto.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/admin/admin.controller.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/admin/admin.controller.spec.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/admin/admin.service.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/admin/admin.service.spec.ts`

**Interfaces:**
- Produces: `POST /api/generation/image-jobs/draft`
- Produces: `PATCH /api/generation/jobs/:id/draft`
- Produces: `POST /api/generation/jobs/:id/confirm`
- Produces: `POST /api/generation/jobs/:id/select-output`
- Produces: `POST /api/generation/jobs/:id/regenerate`

- [ ] **Step 1: Write failing controller contract tests**

Add mocked AdminService methods and assert exact forwarding:

```ts
await request(app.getHttpServer())
  .post("/api/generation/image-jobs/draft")
  .send({ characterId: "ai-1", inputPrompt: "portrait", candidateCount: 3 })
  .expect(201);
expect(createImageGenerationDraft).toHaveBeenCalledWith({
  characterId: "ai-1",
  inputPrompt: "portrait",
  candidateCount: 3,
});

await request(app.getHttpServer())
  .patch("/api/generation/jobs/job-1/draft")
  .send({ prompt: "edited", candidateCount: 2 })
  .expect(200);

await request(app.getHttpServer())
  .post("/api/generation/jobs/job-1/select-output")
  .send({ mediaId: "media-2" })
  .expect(201);
```

Also assert 400 for blank strings, non-integer counts, counts outside 1–4, and missing `mediaId`.

- [ ] **Step 2: Run controller tests and verify the routes fail**

```bash
npm test -- --runInBand src/admin/admin.controller.spec.ts
```

Expected: FAIL with 404 routes or missing mocked methods.

- [ ] **Step 3: Implement DTO validation**

Use `@IsString()`, `@IsNotEmpty()`, `@IsInt()`, `@Min(1)`, and `@Max(4)`:

```ts
export class CreateImageGenerationDraftDto {
  @IsString() @IsNotEmpty() characterId!: string;
  @IsString() @IsNotEmpty() inputPrompt!: string;
  @IsInt() @Min(1) @Max(4) candidateCount!: number;
}

export class UpdateImageGenerationDraftDto {
  @IsString() @IsNotEmpty() prompt!: string;
  @IsInt() @Min(1) @Max(4) candidateCount!: number;
}

export class SelectGenerationOutputDto {
  @IsString() @IsNotEmpty() mediaId!: string;
}
```

- [ ] **Step 4: Add thin controller routes and AdminService wrappers**

Controller methods pass DTO values and route IDs unchanged. AdminService delegates to the GenerationService methods. Record `GENERATION_DRAFT_CREATED`, `GENERATION_DRAFT_CONFIRMED`, and `GENERATION_JOB_REGENERATED` after their successful service calls using the existing `recordCharacterActionLog` helper. Do not add a second selection log because selection is already transactional in GenerationService.

- [ ] **Step 5: Add AdminService delegation and logging tests**

Assert one representative wrapper exactly:

```ts
await service.createImageGenerationDraft({
  characterId: "ai-1",
  inputPrompt: "portrait",
  candidateCount: 3,
});
expect(generation.createImageDraft).toHaveBeenCalledWith({
  characterId: "ai-1",
  inputPrompt: "portrait",
  candidateCount: 3,
});
expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    actionType: "GENERATION_DRAFT_CREATED",
    targetId: "job-1",
  }),
});
```

Cover confirm and regenerate action types, and verify update/select are delegated without duplicate selection logging.

- [ ] **Step 6: Run focused controller and AdminService tests**

```bash
npm test -- --runInBand src/admin/admin.controller.spec.ts src/admin/admin.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the HTTP API**

```bash
git add src/admin/dto/create-image-generation-draft.dto.ts src/admin/dto/update-image-generation-draft.dto.ts src/admin/dto/select-generation-output.dto.ts src/admin/admin.controller.ts src/admin/admin.controller.spec.ts src/admin/admin.service.ts src/admin/admin.service.spec.ts
git commit -m "feat: expose staged image generation API"
```

### Task 5: Make the worker honor each round and stop auto-selection

**Files:**
- Modify: `/Users/hongtaeho/opod/opod-admin/src/worker/generation-worker.service.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/worker/generation-worker.service.spec.ts`

**Interfaces:**
- Consumes: `GenerationJob.candidateCount: number | null`
- Preserves: claim query only selects `status = 'queued'`
- Produces: completed candidates with no `selected` row and no `outputMediaId`

- [ ] **Step 1: Change the end-to-end worker test expectations first**

Add `candidateCount: 3` to the claimed job fixture and expect:

```ts
expect(provider.submit).toHaveBeenCalledWith(expect.objectContaining({
  candidateCount: 3,
}));
expect(txJobUpdateMany).toHaveBeenCalledWith({
  where: { id: "job-1", status: "running" },
  data: expect.objectContaining({
    status: "completed",
    outputMediaId: null,
  }),
});
expect(txOutputsCreateMany).toHaveBeenCalledWith({
  data: expect.arrayContaining([
    expect.objectContaining({ candidateIndex: 0, selected: false }),
    expect.objectContaining({ candidateIndex: 1, selected: false }),
  ]),
});
```

Add a separate fixture with `candidateCount: null` and assert the provider receives the configured `candidateCount: 2`.

- [ ] **Step 2: Run the worker suite and verify old auto-selection fails**

```bash
npm test -- --runInBand src/worker/generation-worker.service.spec.ts
```

Expected: FAIL because the worker still uses the global count and selects candidate zero.

- [ ] **Step 3: Implement per-job count and unselected persistence**

Extend `ClaimedJob` with `candidateCount: number | null`. In `buildRequest` use:

```ts
candidateCount: job.candidateCount ?? this.config.candidateCount,
```

In `persistSuccess`, set `outputMediaId: null` and create every output with `selected: false`. Leave media upload, cost tracking, leases, retries, and provider selection unchanged.

- [ ] **Step 4: Run worker and draft-worker tests**

```bash
npm test -- --runInBand src/worker/generation-worker.service.spec.ts src/worker/draft-worker.service.spec.ts
```

Expected: PASS; draft jobs with null count still use worker configuration when claimed.

- [ ] **Step 5: Commit worker behavior**

```bash
git add src/worker/generation-worker.service.ts src/worker/generation-worker.service.spec.ts
git commit -m "feat: generate unselected image candidates per job"
```

### Task 6: Add pure admin-SPA workflow helpers

**Files:**
- Modify: `/Users/hongtaeho/opod/opod-admin/packages/admin/main.js`
- Modify: `/Users/hongtaeho/opod/opod-admin/packages/admin/test/main.test.mjs`

**Interfaces:**
- Produces: `generationRouteState(hash)`
- Produces: `generationWorkflowStep(job)`
- Produces: `imageDraftPayload(form)` and `imageDraftUpdatePayload(form)`
- Produces: `imageWorkflowRequest(action, jobId, value)`

- [ ] **Step 1: Write failing tests for route and step restoration**

```js
assert.deepEqual(generationRouteState("#generation?jobId=job-1"), {
  jobId: "job-1",
});
assert.equal(generationWorkflowStep({ status: "draft" }), "prompt");
assert.equal(generationWorkflowStep({ status: "queued" }), "generating");
assert.equal(generationWorkflowStep({ status: "running" }), "generating");
assert.equal(
  generationWorkflowStep({ status: "completed", outputMediaId: null }),
  "select",
);
assert.equal(
  generationWorkflowStep({ status: "completed", outputMediaId: "media-1" }),
  "complete",
);
assert.equal(generationWorkflowStep({ status: "failed" }), "failed");
```

- [ ] **Step 2: Write failing payload and request tests**

Assert trimmed strings and numeric candidate count, plus exact requests:

```js
assert.deepEqual(imageDraftPayload(form), {
  characterId: "ai-1",
  inputPrompt: "street portrait",
  candidateCount: 3,
});
assert.deepEqual(imageWorkflowRequest("confirm", "job-1"), {
  path: "/api/generation/jobs/job-1/confirm",
  options: jsonPost({}),
});
assert.deepEqual(imageWorkflowRequest("select", "job-1", "media-2"), {
  path: "/api/generation/jobs/job-1/select-output",
  options: jsonPost({ mediaId: "media-2" }),
});
```

Use the test file's existing request-shape literals rather than introducing a test-only `jsonPost` helper if none exists.

- [ ] **Step 3: Run the admin package tests and confirm missing exports**

```bash
npm --workspace @ai-sns/admin test
```

Expected: FAIL because the new helpers are not exported.

- [ ] **Step 4: Implement the pure helpers**

`generationRouteState` reads only `jobId`. `generationWorkflowStep` uses status plus `outputMediaId`, never timestamps or client-only state. `imageWorkflowRequest` maps:

```text
create     POST  /api/generation/image-jobs/draft
update     PATCH /api/generation/jobs/:id/draft
confirm    POST  /api/generation/jobs/:id/confirm
select     POST  /api/generation/jobs/:id/select-output
regenerate POST  /api/generation/jobs/:id/regenerate
```

Keep existing legacy queue helpers and routes intact for API compatibility, but the new workflow UI must not call them.

- [ ] **Step 5: Run the admin package tests**

```bash
npm --workspace @ai-sns/admin test
```

Expected: PASS.

- [ ] **Step 6: Commit helper contracts**

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "feat: add staged generation UI helpers"
```

### Task 7: Render and operate the focused stepper

**Files:**
- Modify: `/Users/hongtaeho/opod/opod-admin/packages/admin/main.js`
- Modify: `/Users/hongtaeho/opod/opod-admin/packages/admin/styles.css`
- Modify: `/Users/hongtaeho/opod/opod-admin/packages/admin/test/main.test.mjs`
- Modify: `/Users/hongtaeho/opod/opod-admin/packages/admin/test/smoke.test.mjs`

**Interfaces:**
- Consumes: Task 6 helpers and Task 4 endpoints
- Produces: list → stepper navigation, polling, candidate selection, and regeneration history UI

- [ ] **Step 1: Add failing rendering tests for each workflow stage**

Export a small pure `generationWorkflowPanel(job, history, characters, settings)` renderer and assert meaningful user behavior:

```js
assert.match(generationWorkflowPanel(draftJob, [], characters, settings), /최종 프롬프트 확인/);
assert.match(generationWorkflowPanel(draftJob, [], characters, settings), /이미지 3장 생성/);
assert.match(generationWorkflowPanel(runningJob, [], characters, settings), /생성 중/);
assert.match(generationWorkflowPanel(completedJob, [], characters, settings), /최종 확정/);
assert.match(generationWorkflowPanel(selectedJob, history, characters, settings), /확정 완료/);
assert.match(generationWorkflowPanel(selectedJob, history, characters, settings), /이전 생성 회차/);
```

Assert candidate image URLs are escaped through the existing safe media URL path and that a failed job displays its server error plus `프롬프트 수정 후 새 회차`.

- [ ] **Step 2: Run admin tests and verify renderer failure**

```bash
npm --workspace @ai-sns/admin test
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement the focused stepper rendering**

In `renderGeneration()`:

1. Parse `generationRouteState(location.hash)`.
2. With no job ID, render the existing settings/cards/table, replace `큐 등록` with `새 이미지 생성`, and derive each image-job row label from `generationWorkflowStep` (`프롬프트 확인`, `생성 대기`, `생성 중`, `후보 선택`, `확정 완료`, or `생성 실패`).
3. For a new flow, render the request-input panel locally; submitting creates a server draft and navigates to `#generation?jobId=<id>`.
4. With a job ID, fetch `/api/generation/jobs/:id`, follow `originJobId` one job at a time to build the ancestor history, and render `generationWorkflowPanel`.
5. Add a back button that returns to `#generation`.

The stepper labels are exactly `요청 입력`, `프롬프트 확인`, `후보 생성`, `후보 선택`. Only the current card is expanded. History is a collapsed `<details>` list containing prompt, count, candidates, selected result, cost, and error.

- [ ] **Step 4: Wire forms and click actions**

Add handlers for:

```text
image-draft-create  -> create request, navigate to returned job
image-draft-update  -> PATCH prompt/count, re-render same job
image-confirm       -> confirm request, re-render same job
image-select        -> store selected mediaId in UI state only
image-select-confirm-> select-output request, re-render same job
image-regenerate    -> regenerate request, navigate to new job
generation-back     -> #generation
```

Disable buttons through the existing `pendingForms`/request lifecycle while a request is in flight. Do not optimistically mark a candidate selected on the server before `최종 확정`.

- [ ] **Step 5: Add bounded polling for queued/running jobs**

Store one timer in `ui.generationPollTimer`. Clear it before every `renderApp()` and schedule a 2-second refresh only when the current route is the same generation job and its status is queued or running:

```js
function scheduleGenerationRefresh(jobId) {
  clearTimeout(ui.generationPollTimer);
  ui.generationPollTimer = setTimeout(() => {
    const state = generationRouteState(location.hash);
    if (currentRoute() === "generation" && state.jobId === jobId) {
      renderApp();
    }
  }, 2000);
}
```

This guarantees one timer, stops after completion/failure, and survives a full page refresh through the URL job ID.

- [ ] **Step 6: Add scoped CSS and smoke coverage**

Add only workflow-prefixed classes: `.generation-stepper`, `.generation-step`, `.generation-workflow-card`, `.generation-candidate-grid`, `.generation-candidate`, `.generation-history`. Use four columns on desktop, two below 900px, and one below 560px. Preserve the existing Broadsheet tokens and button classes.

Extend smoke coverage to assert the built page source contains `새 이미지 생성`, the four step labels, and no new external runtime dependency.

- [ ] **Step 7: Run admin checks**

```bash
npm run admin:check
npm run format
```

Expected: all Node tests and boundary/smoke checks PASS; Prettier check exits 0.

- [ ] **Step 8: Commit the stepper UI**

```bash
git add packages/admin/main.js packages/admin/styles.css packages/admin/test/main.test.mjs packages/admin/test/smoke.test.mjs
git commit -m "feat: add focused image generation stepper"
```

### Task 8: Disable scheduling by default and verify the full workflow

**Files:**
- Modify: `/Users/hongtaeho/opod/opod-admin/src/worker/draft-worker.service.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/src/worker/draft-worker.service.spec.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/.env` (local-only, ignored by git)
- Modify: `/Users/hongtaeho/opod/opod-admin/.env.production.example`
- Modify: `/Users/hongtaeho/opod/opod-admin/test/generation.e2e-spec.ts`
- Modify: `/Users/hongtaeho/opod/opod-admin/docs/api/admin-generation-jobs.md`

**Interfaces:**
- Produces: scheduler default OFF
- Verifies: request → prompt edit → confirm → worker → select → regenerate

- [ ] **Step 1: Write the failing scheduler-default test**

```ts
expect(draftWorkerConfigFromEnv({})).toMatchObject({
  enabled: false,
  schedulerEnabled: false,
});
expect(
  draftWorkerConfigFromEnv({ DRAFT_SCHEDULER_ENABLED: "true" })
    .schedulerEnabled,
).toBe(true);
```

- [ ] **Step 2: Run the scheduler test and confirm the old default fails**

```bash
npm test -- --runInBand src/worker/draft-worker.service.spec.ts
```

Expected: FAIL because the current default is true.

- [ ] **Step 3: Flip the default and explicit local configuration**

Change configuration parsing to:

```ts
schedulerEnabled:
  env.DRAFT_SCHEDULER_ENABLED === "true" ||
  env.DRAFT_SCHEDULER_ENABLED === "1",
```

Add `DRAFT_SCHEDULER_ENABLED=false` to `.env` and `.env.production.example`. Keep `WORKER_ENABLED=true` in the local `.env` so confirmed generation jobs still run. Do not stage `.env` because it is intentionally ignored.

- [ ] **Step 4: Write the end-to-end workflow test**

In `test/generation.e2e-spec.ts`, create a character and call the new endpoints in order. Assert:

```ts
expect(created.body).toMatchObject({
  status: "draft",
  inputPrompt: "street portrait",
  candidateCount: 2,
});
expect(edited.body).toMatchObject({
  status: "draft",
  prompt: "edited final prompt",
  candidateCount: 3,
});
expect(confirmed.body.status).toBe("queued");
```

Call `POST /api/generation/worker/run` with the job ID, poll `GET /api/generation/jobs/:id` until status is completed with a bounded deadline, assert every candidate has `selected: false` and `outputMediaId` is absent, select one returned `mediaId`, and assert exactly that candidate is selected. Finally call regenerate and assert the new response has `status: "draft"` and `originJobId` equal to the completed job.

- [ ] **Step 5: Update the API documentation**

Document the five endpoints, exact request/response fields, state interpretation, 1–4 validation, idempotent confirm/selection, regeneration lineage, and the rule that provider work begins only after confirm. Update the status filter list to include `draft`.

- [ ] **Step 6: Apply the schema to the isolated local test database and run E2E**

```bash
cd /Users/hongtaeho/opod/opod-service-backend && npm run db:up
cd /Users/hongtaeho/opod/opod-service-backend && npm run db:push
cd /Users/hongtaeho/opod/opod-admin && npm run test:e2e -- --runInBand test/generation.e2e-spec.ts
```

Expected: database commands exit 0 and the generation E2E suite PASSes using the local provider fallback.

- [ ] **Step 7: Run complete verification in both repositories**

```bash
cd /Users/hongtaeho/opod/opod-service-backend
npm run db:generate
npm run build
npm test -- --runInBand

cd /Users/hongtaeho/opod/opod-admin
npm run schema:check
npm run db:generate
npm run lint
npm run format
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run admin:check
npm run build
```

Expected: every command exits 0. If an unrelated pre-existing failure appears, record the exact command and output; do not modify unrelated code.

- [ ] **Step 8: Commit scheduler, E2E, and documentation changes**

```bash
git add src/worker/draft-worker.service.ts src/worker/draft-worker.service.spec.ts .env.production.example test/generation.e2e-spec.ts docs/api/admin-generation-jobs.md
git commit -m "feat: finish manual image generation workflow"
```

Do not add the ignored `.env` file to the commit.

## Execution Notes

- Work on one repository at a time when committing; `/Users/hongtaeho/opod` itself is not a Git repository.
- Before each commit, run `git status --short` in the relevant repository and stage only files named by that task.
- The visual-companion scratch directory `.superpowers/` is not product code and must not be staged.
- Do not use the legacy manual `start`, `run`, or `complete` endpoints from the new UI.
