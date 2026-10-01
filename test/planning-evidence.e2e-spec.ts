import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/core/database/database.service";
import { AppConfigService } from "../src/core/config/app-config.service";
import {
  characters,
  postDrafts,
  llmLogs,
  generationJobs,
} from "../src/core/database/schema";
import { DraftWorkerRepository } from "../src/drafts/draft-worker.repository";
import { LlmLogService } from "../src/llm-logs/llm-log.service";
import { GenerationSettingsService } from "../src/settings/generation-settings.service";
import { CharacterContentProfileService } from "../src/character-content-profiles/character-content-profile.service";
import { PostPipelineV3Runner } from "../src/post-production/post-pipeline-v3.runner";
import { POST_AGENT_CONTRACTS } from "../prompts/post-agent-contracts";

describe("planning response evidence persistence", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ["post_plan", "evidence"],
    ["image_plan", "evidence"],
    ["post_plan", "malformed"],
    ["image_plan", "malformed"],
    ["post_plan", "missing_envelope"],
  ] as const)(
    "preserves a rejected %s/%s response and excludes it from automatic claims",
    async (stage, variant) => {
      const db = app.get(DatabaseService).client;
      const characterId = randomUUID();
      const draftId = randomUUID();
      await db.insert(characters).values({
        id: characterId,
        publicId: `evidence-${characterId}`,
        displayName: "Synthetic",
        bio: "동네 사진을 기록한다",
      });
      const previous = {
        revision: 1,
        hash: "previous",
        output: {
          status: "ready",
          intent: {
            premise: "동네 간판을 기록한다",
            primaryPurpose: "산책 기록",
            secondaryPurpose: null,
          },
        },
      };
      await db.insert(postDrafts).values({
        id: draftId,
        characterId,
        status: "generating",
        attemptCount: 1,
        conceptJson: {
          mode: "auto",
          pipelineVersion: "post-pipeline-v4",
          pipeline: {
            stage,
            state: "running",
            imageCount: stage === "image_plan" ? 2 : null,
            reasonCodes: [],
          },
          ...(stage === "image_plan" ? { postPlanning: previous } : {}),
        },
      });
      const planningOutput =
        stage === "post_plan"
          ? {
              status: "conflict",
              conflicts: [
                {
                  left: {
                    source: "operatorRequest",
                    text: "사진을 찍지 않는다",
                  },
                  right: {
                    source: "persona.characterContext",
                    text: "움직인다",
                  },
                  reason: "출처가 없는 충돌",
                },
              ],
            }
          : {
              status: "blocked",
              reasons: [
                {
                  code: "insufficient_distinct_shots",
                  detail: "충족 가능한 두 장을 구성할 수 있다",
                  evidence: {
                    requirements: [
                      {
                        path: "postPlan.intent.premise",
                        quote: "동네 간판을 기록한다",
                      },
                    ],
                    referenceChecks: [],
                    alternatives: [
                      {
                        description: "전경과 간판 상세를 각각 촬영한다",
                        satisfiesRequirements: true,
                      },
                    ],
                  },
                },
              ],
            };
      const output = variant === "malformed" ? "{broken JSON" : planningOutput;
      const content =
        variant === "malformed"
          ? String(output)
          : JSON.stringify(
              variant === "missing_envelope" ? output : { result: output },
            );
      const fetchFn = jest.fn(async () =>
        Response.json({
          choices: [{ message: { content } }],
        }),
      );
      const settings = app.get(GenerationSettingsService);
      const runner = new PostPipelineV3Runner(
        app.get(DraftWorkerRepository),
        {
          resolvePlannerSettings: async () => ({
            apiUrl: "https://fixture.test/chat",
            apiKey: "fixture",
            model: "fixture",
          }),
          resolveAspectRatios: () => settings.resolveAspectRatios(),
        } as never,
        app.get(LlmLogService),
        app.get(AppConfigService),
        app.get(CharacterContentProfileService),
        () => 0.5,
        fetchFn as typeof fetch,
        null,
        {
          execution: async () => ({
            ...POST_AGENT_CONTRACTS[stage],
            id: "1",
            revision: 1,
            aiModelId: "1",
            provider: "openai-compatible",
            effectiveModel: "fixture",
            systemPrompt: "Synthetic planning contract",
          }),
        } as never,
        {
          retrieve: async () => ({
            identityReferences: [],
            locationReferences: {},
            trace: { model: "fixture" },
          }),
        } as never,
      );
      await runner.runCurrentStage(draftId);
      const [saved] = await db
        .select()
        .from(postDrafts)
        .where(eq(postDrafts.id, draftId));
      const concept = saved.conceptJson as Record<string, unknown>;
      expect(saved).toMatchObject({
        status: "planned",
        leaseExpiresAt: null,
        attemptCount: 0,
      });
      expect(concept.pipeline).toMatchObject({
        stage,
        state: "needs_input",
        imageCount: stage === "image_plan" ? 2 : null,
        reasonCodes: ["invalid_agent_response"],
        failure: { retryable: false },
      });
      expect(concept.rejectedAgentResponse).toMatchObject({ stage, output });
      if (stage === "image_plan")
        expect(concept.postPlanning).toEqual(previous);
      const logs = await db
        .select()
        .from(llmLogs)
        .where(eq(llmLogs.requestId, draftId));
      expect(logs).toHaveLength(1);
      expect(concept.rejectedAgentResponse).toMatchObject({
        producerLogId: String(logs[0].id),
        input: JSON.parse(
          (logs[0].userPromptJson as { content: string }[])[0].content,
        ),
      });
      const response = logs[0].responseJson as {
        choices: { message: { content: string } }[];
      };
      expect(response.choices[0].message.content).toBe(content);
      expect(
        await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.draftId, draftId)),
      ).toEqual([]);
      expect(await app.get(DraftWorkerRepository).claimV3Draft(30)).not.toBe(
        draftId,
      );
      await runner.runCurrentStage(draftId);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );
});
