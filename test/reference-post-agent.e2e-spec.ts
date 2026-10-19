import { Test, TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ConfigModule } from "../src/core/config/config.module";
import { DatabaseModule } from "../src/core/database/database.module";
import { DatabaseService } from "../src/core/database/database.service";
import {
  characters,
  generationJobOutputs,
  generationJobs,
  media,
  postDrafts,
} from "../src/core/database/schema";
import { DraftsModule } from "../src/drafts/drafts.module";
import { DraftsService } from "../src/drafts/drafts.service";
import { DraftWorkerRepository } from "../src/drafts/draft-worker.repository";
import { generationSetHash } from "../src/post-production/post-pipeline-v3";

// Uses the disposable PostgreSQL container configured by jest-e2e.json.
// No worker loops, LLM clients or media providers are started.
describe("reference Agent database concurrency contracts", () => {
  let module: TestingModule;
  let db: DatabaseService;
  let drafts: DraftsService;
  let publisher: DraftWorkerRepository;
  let characterId: string;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, DraftsModule],
      providers: [DraftWorkerRepository],
    }).compile();
    db = module.get(DatabaseService);
    drafts = module.get(DraftsService);
    publisher = module.get(DraftWorkerRepository);
  });
  beforeEach(async () => {
    const [character] = await db.client
      .insert(characters)
      .values({
        publicId: `reference-race-${randomUUID()}`,
        displayName: "Reference race fixture",
        bio: "Fictional test character",
      })
      .returning();
    characterId = character.id;
  });
  afterAll(async () => module?.close());

  async function fixture(
    sourceId = randomUUID(),
    sha256 = randomUUID(),
    status: "approved" | "generating" | "planned" = "approved",
  ) {
    const [output] = await db.client
      .insert(media)
      .values({
        mediaType: "image",
        url: `https://example.test/${randomUUID()}.png`,
      })
      .returning();
    const [draft] = await db.client
      .insert(postDrafts)
      .values({
        characterId,
        status,
        caption: "Independent caption",
        conceptJson: {},
      })
      .returning();
    const [job] = await db.client
      .insert(generationJobs)
      .values({
        characterId,
        draftId: draft.id,
        mediaType: "image",
        prompt: "Fixture prompt",
        status: "completed",
        outputMediaId: output.id,
        paramsJson: {
          _referenceAgent: { promptRevision: "1", shotId: "shot-1" },
        },
      })
      .returning();
    await db.client.insert(generationJobOutputs).values({
      jobId: job.id,
      mediaId: output.id,
      candidateIndex: 0,
      selected: true,
      filterPreset: "none",
    });
    const concept = {
      postGenerationAgent: "reference-v1",
      mode: "auto",
      pipeline: {
        stage: status === "planned" ? "reference_select" : "caption",
        state: status === "planned" ? "pending" : "running",
      },
      referenceSelection: {
        shots: [
          {
            shotId: "shot-1",
            sortOrder: 0,
            mediaId: sourceId,
            sha256,
            pose: "same pose",
          },
        ],
      },
      promptBuild: { revision: 1 },
      generationBuild: { jobIds: [job.id], promptRevision: 1 },
      captionBuild: {
        source: {
          promptBuildRevision: 1,
          generationSetHash: generationSetHash([
            { sortOrder: 0, jobId: job.id, mediaId: output.id },
          ]),
        },
      },
    };
    await db.client
      .update(postDrafts)
      .set({ conceptJson: concept })
      .where(eq(postDrafts.id, draft.id));
    return { draftId: draft.id, jobId: job.id, mediaId: output.id, concept };
  }
  async function publish(
    item: Awaited<ReturnType<typeof fixture>>,
    lease: Date,
  ) {
    return publisher.persistPublishedPost({
      draftId: item.draftId,
      characterId,
      contentType: "feed",
      caption: "Independent caption",
      hashtags: [],
      leaseExpiresAt: lease,
      referencePublication: { expectedConceptJson: item.concept },
      media: [{ originalMediaId: item.mediaId, finishedFile: null }],
    });
  }
  it("allows only one concurrent stage claim and rejects stale stage output CAS", async () => {
    const item = await fixture(undefined, undefined, "planned");
    const initial = await drafts.getReferenceDraftState(item.draftId);
    const guard = {
      expectedStage: "reference_select",
      expectedRevision: initial.draft.updatedAt.toISOString(),
    };
    const claims = await Promise.all([
      drafts.claimReferenceDraftNow(item.draftId, 60, guard),
      drafts.claimReferenceDraftNow(item.draftId, 60, guard),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const state = await drafts.getReferenceDraftState(item.draftId);
    const changed = {
      ...item.concept,
      pipeline: { stage: "image_prompt", state: "ready" },
    };
    expect(
      await drafts.saveReferenceStage({
        draftId: item.draftId,
        expectedConceptJson: item.concept,
        conceptJson: changed,
      }),
    ).toBe(false);
    expect(
      await drafts.saveReferenceStage({
        draftId: item.draftId,
        expectedConceptJson: state.draft.conceptJson,
        conceptJson: changed,
      }),
    ).toBe(true);
    expect(
      (await drafts.getReferenceDraftState(item.draftId)).draft.status,
    ).toBe("planned");
  });
  it.each(["id", "hash"] as const)(
    "reserves an exact source %s only once across concurrent publications",
    async (key) => {
      const source = randomUUID();
      const hash = randomUUID();
      const first = await fixture(source, hash);
      const second = await fixture(
        key === "id" ? source : randomUUID(),
        key === "hash" ? hash : randomUUID(),
      );
      const outcomes = await Promise.allSettled([
        drafts.claimReferencePublication(first.draftId, 60),
        drafts.claimReferencePublication(second.draftId, 60),
      ]);
      expect(
        outcomes.filter(
          (result) => result.status === "fulfilled" && result.value !== null,
        ),
      ).toHaveLength(1);
      expect(
        outcomes.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
    },
  );
  it("allows different exact sources with the same pose", async () => {
    const first = await fixture();
    const second = await fixture();
    const claims = await Promise.all([
      drafts.claimReferencePublication(first.draftId, 60),
      drafts.claimReferencePublication(second.draftId, 60),
    ]);
    expect(claims.map((claim) => claim?.id).sort()).toEqual(
      [first.draftId, second.draftId].sort(),
    );
  });
  it("rejects an expired publisher even after its lease is replaced", async () => {
    const item = await fixture();
    const old = await drafts.claimReferencePublication(item.draftId, 60);
    expect(old?.leaseExpiresAt).toBeInstanceOf(Date);
    await db.client
      .update(postDrafts)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(postDrafts.id, item.draftId));
    await expect(publish(item, old!.leaseExpiresAt!)).rejects.toThrow(
      "publishable state",
    );
    const replacement = await drafts.claimReferencePublication(
      item.draftId,
      60,
    );
    await expect(publish(item, old!.leaseExpiresAt!)).rejects.toThrow(
      "publishable state",
    );
    expect(
      (await drafts.getReferenceDraftState(item.draftId)).draft.status,
    ).toBe("approved");
    await publish(item, replacement!.leaseExpiresAt!);
    expect(
      (await drafts.getReferenceDraftState(item.draftId)).draft.status,
    ).toBe("published");
  });
  it("a published exact source blocks the next reservation", async () => {
    const source = randomUUID();
    const first = await fixture(source);
    const claim = await drafts.claimReferencePublication(first.draftId, 60);
    await publish(first, claim!.leaseExpiresAt!);
    const next = await fixture(source);
    await expect(
      drafts.claimReferencePublication(next.draftId, 60),
    ).rejects.toThrow("already_published_or_reserved");
  });
  it("rejects a late caption when the selected output changes", async () => {
    const item = await fixture(undefined, undefined, "generating");
    const [replacement] = await db.client
      .insert(media)
      .values({
        mediaType: "image",
        url: "https://example.test/replacement.png",
      })
      .returning();
    await db.client
      .update(generationJobOutputs)
      .set({ selected: false })
      .where(eq(generationJobOutputs.jobId, item.jobId));
    await db.client.insert(generationJobOutputs).values({
      jobId: item.jobId,
      mediaId: replacement.id,
      candidateIndex: 1,
      selected: true,
    });
    await db.client
      .update(generationJobs)
      .set({ outputMediaId: replacement.id })
      .where(eq(generationJobs.id, item.jobId));
    expect(
      await drafts.saveReferenceStage({
        draftId: item.draftId,
        expectedConceptJson: item.concept,
        conceptJson: item.concept,
        status: "needs_review",
        caption: "Late caption",
        expectedOutputs: [{ jobId: item.jobId, mediaId: item.mediaId }],
      }),
    ).toBe(false);
    const state = await drafts.getReferenceDraftState(item.draftId);
    expect(state.draft.status).toBe("generating");
    expect(state.draft.caption).toBe("Independent caption");
  });
});
