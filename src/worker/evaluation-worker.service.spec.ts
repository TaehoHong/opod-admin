import { EVAL_RUBRIC_VERSION } from "../../prompts/plan-evaluator";
import {
  EvaluationWorkerService,
  EvaluationWorkerConfig,
} from "./evaluation-worker.service";
import { EvaluationRepository } from "./evaluation.repository";
import { PlanEvaluator } from "./plan-evaluator";
import { PromptEvaluator } from "./prompt-evaluator";
import { PLAN_EVAL_DIMENSIONS } from "../../prompts/plan-evaluator";
import { PROMPT_EVAL_SHOT_DIMENSIONS } from "../../prompts/prompt-evaluator";

const baseConfig: EvaluationWorkerConfig = {
  pollIntervalMs: 15_000,
  leaseSeconds: 120,
  maxAttempts: 3,
};

const planClaim = {
  evaluationId: "eval-1",
  draftId: "draft-1",
  characterId: "char-1",
  contentLanguage: "en",
  attempt: 1,
};

const planSource = {
  draftId: "draft-1",
  characterId: "char-1",
  contentLanguage: "en",
  characterName: "Mia",
  bio: "seoul cafe hopper",
  interests: ["coffee"],
  conceptJson: {
    planInput: {
      characterName: "Mia",
      bio: "seoul cafe hopper",
      interests: ["coffee"],
      personas: [{ title: "voice", content: "casual, playful" }],
      memories: ["published a beach post"],
      recentCaptions: ["morning espresso ritual"],
    },
    plan: {
      caption: "golden hour at my favorite corner table",
      hashtags: ["cafe"],
      shots: [
        {
          sortOrder: 0,
          scene: "창가 테이블",
          captureSetup: "폰 셀피",
          characterVisible: true,
          referenceIds: ["ref-1"],
        },
      ],
    },
  },
};

const promptSource = {
  draftId: "draft-1",
  caption: "golden hour",
  conceptJson: {},
  jobs: [
    {
      id: "job-new",
      sortOrder: 0,
      prompt:
        "A young woman at a sunlit cafe corner table, golden hour light, phone selfie framing, warm tones and natural skin texture",
      paramsJson: {
        _shot: {
          scene: "창가 테이블",
          captureSetup: "폰 셀피",
          characterVisible: true,
          targetModelId: "fal-ai/flux/dev",
        },
      },
      createdAt: new Date("2026-08-07T02:00:00Z"),
    },
    {
      // 같은 sortOrder의 옛 잡 — 최신 잡만 평가해야 한다.
      id: "job-old",
      sortOrder: 0,
      prompt: "outdated prompt that must not be evaluated",
      paramsJson: {},
      createdAt: new Date("2026-08-07T01:00:00Z"),
    },
    {
      // 빌드 전(빈 프롬프트) 컷 — 평가 대상에서 제외돼야 한다.
      id: "job-empty",
      sortOrder: 1,
      prompt: "",
      paramsJson: {},
      createdAt: new Date("2026-08-07T02:00:00Z"),
    },
  ],
};

function repositoryFake() {
  return {
    sweepExpiredLeases: jest.fn().mockResolvedValue(0),
    claim: jest.fn().mockResolvedValue(undefined),
    loadPlanSource: jest.fn().mockResolvedValue(planSource),
    loadPromptSource: jest.fn().mockResolvedValue(promptSource),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    findByDraft: jest.fn().mockResolvedValue([]),
    findCompletedInPeriod: jest.fn().mockResolvedValue([]),
    createReport: jest.fn(),
    listReports: jest.fn(),
    findReport: jest.fn(),
  } as unknown as jest.Mocked<EvaluationRepository>;
}

function planEvaluatorFake(
  overrides: Partial<PlanEvaluator> = {},
): PlanEvaluator {
  return {
    name: "llm:judge-model",
    evaluate: jest.fn().mockResolvedValue({
      scores: Object.fromEntries(
        PLAN_EVAL_DIMENSIONS.map((dimension) => [
          dimension,
          { score: 4, reason: "ok" },
        ]),
      ),
      issues: [],
      suggestions: [],
      overallScore: 4,
    }),
    ...overrides,
  } as PlanEvaluator;
}

function promptEvaluatorFake(
  overrides: Partial<PromptEvaluator> = {},
): PromptEvaluator {
  return {
    name: "llm:judge-model",
    evaluate: jest.fn().mockResolvedValue({
      shots: [
        {
          sortOrder: 0,
          scores: Object.fromEntries(
            PROMPT_EVAL_SHOT_DIMENSIONS.map((dimension) => [
              dimension,
              { score: 4, reason: "ok" },
            ]),
          ),
          issues: [],
          suggestions: [],
        },
      ],
      crossShot: { score: 4, issues: [] },
      overallScore: 4,
    }),
    ...overrides,
  } as PromptEvaluator;
}

function service(
  repository: jest.Mocked<EvaluationRepository>,
  plan: PlanEvaluator,
  prompt: PromptEvaluator,
  enabled = true,
) {
  return new EvaluationWorkerService(
    repository,
    async () => plan,
    async () => prompt,
    async () => enabled,
    baseConfig,
  );
}

describe("EvaluationWorkerService", () => {
  // 자동 루프 토글은 설정 화면이 소유한다. 여기서 새면 화면에서 끈 평가가
  // 계속 LLM을 호출한다.
  it("자동 루프가 꺼져 있으면 lease 회수도 클레임도 하지 않는다", async () => {
    const repository = repositoryFake();
    repository.claim.mockResolvedValue(planClaim);

    await service(
      repository,
      planEvaluatorFake(),
      promptEvaluatorFake(),
      false,
    ).tick();

    expect(repository.sweepExpiredLeases).not.toHaveBeenCalled();
    expect(repository.claim).not.toHaveBeenCalled();
  });

  // 수동 실행은 토글과 무관해야 한다 — 꺼둔 채로 한 건만 돌려보는 것이
  // 운영자가 평가를 켜기 전에 하는 일이다.
  it("수동 실행은 자동 루프가 꺼져 있어도 실행한 종류를 돌려준다", async () => {
    const repository = repositoryFake();
    repository.claim.mockImplementation(async (kind) =>
      kind === "plan" ? planClaim : undefined,
    );

    await expect(
      service(
        repository,
        planEvaluatorFake(),
        promptEvaluatorFake(),
        false,
      ).runOnce(),
    ).resolves.toEqual({ evaluated: ["plan"] });
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });

  it("수동 실행에 대기 건이 없으면 빈 목록을 돌려준다", async () => {
    const repository = repositoryFake();

    await expect(
      service(repository, planEvaluatorFake(), promptEvaluatorFake()).runOnce(),
    ).resolves.toEqual({ evaluated: [] });
  });

  it("평가자가 unconfigured면 클레임 없이 쉰다 — 실패 행을 쌓지 않는다", async () => {
    const repository = repositoryFake();
    const unconfigured = { name: "unconfigured", evaluate: jest.fn() };
    await service(
      repository,
      unconfigured as unknown as PlanEvaluator,
      unconfigured as unknown as PromptEvaluator,
    ).tick();
    expect(repository.claim).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("기획 평가 성공 시 completed로 저장한다", async () => {
    const repository = repositoryFake();
    repository.claim.mockImplementation(async (kind) =>
      kind === "plan" ? planClaim : undefined,
    );
    const plan = planEvaluatorFake();
    await service(repository, plan, promptEvaluatorFake()).tick();
    expect(repository.claim).toHaveBeenCalledWith(
      "plan",
      baseConfig.leaseSeconds,
      baseConfig.maxAttempts,
      EVAL_RUBRIC_VERSION,
    );
    // 평가 입력은 planInput 스냅숏 + 캐릭터 콘텐츠 언어로 조립된다.
    expect(plan.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        contentLanguage: "en",
        recentCaptions: ["morning espresso ritual"],
        plan: expect.objectContaining({
          caption: "golden hour at my favorite corner table",
        }),
      }),
      { requestId: "draft-1", characterId: "char-1" },
    );
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluationId: "eval-1",
        evaluatorName: "llm:judge-model",
        overallScore: 4,
      }),
    );
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("기획 평가 실패 시 failed로 전환한다 — draft 상태는 건드리지 않는다", async () => {
    const repository = repositoryFake();
    repository.claim.mockImplementation(async (kind) =>
      kind === "plan" ? planClaim : undefined,
    );
    const plan = planEvaluatorFake({
      evaluate: jest.fn().mockRejectedValue(new Error("judge exploded")),
    });
    await service(repository, plan, promptEvaluatorFake()).tick();
    expect(repository.fail).toHaveBeenCalledWith("eval-1", "judge exploded");
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("프롬프트 평가는 컷별 최신·비어있지 않은 잡만 심사하고 jobId를 고정 기록한다", async () => {
    const repository = repositoryFake();
    repository.claim.mockImplementation(async (kind) =>
      kind === "prompt" ? { ...planClaim, evaluationId: "eval-2" } : undefined,
    );
    const prompt = promptEvaluatorFake();
    await service(repository, planEvaluatorFake(), prompt).tick();
    const input = (prompt.evaluate as jest.Mock).mock.calls[0][0];
    // 옛 잡(job-old)과 빈 프롬프트(job-empty)는 제외된다.
    expect(input.shots).toHaveLength(1);
    expect(input.shots[0].prompt).toContain("sunlit cafe corner table");
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluationId: "eval-2",
        scoresJson: expect.objectContaining({
          shots: [expect.objectContaining({ sortOrder: 0, jobId: "job-new" })],
        }),
      }),
    );
  });

  it("빌드된 프롬프트가 없으면 평가를 실패 처리한다", async () => {
    const repository = repositoryFake();
    repository.claim.mockImplementation(async (kind) =>
      kind === "prompt" ? { ...planClaim, evaluationId: "eval-3" } : undefined,
    );
    repository.loadPromptSource.mockResolvedValue({
      ...promptSource,
      jobs: [promptSource.jobs[2]],
    });
    await service(
      repository,
      planEvaluatorFake(),
      promptEvaluatorFake(),
    ).tick();
    expect(repository.fail).toHaveBeenCalledWith(
      "eval-3",
      expect.stringContaining("no built prompts"),
    );
  });
});
