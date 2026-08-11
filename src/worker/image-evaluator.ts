import {
  IMAGE_EVAL_DIMENSIONS,
  IMAGE_EVAL_HARD_FAILURES,
  IMAGE_EVALUATOR_SYSTEM_PROMPT,
  ImageEvalDimension,
  ImageEvalHardFailure,
  ImageEvaluationMedia,
  ImageEvaluationPromptInput,
  buildImageEvaluatorUserPrompt,
} from "../../prompts/image-evaluator";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";
import {
  contentFromChatCompletion,
  PlannerProviderSettings,
} from "./content-planner";
import {
  DimensionScore,
  extractJson,
  strictOverallScore,
  validateScore,
} from "./plan-evaluator";
import { MediaBytesReader } from "./reference-captioner";

export type { ImageEvaluationPromptInput } from "../../prompts/image-evaluator";

export type ImageCandidateEvaluation = {
  candidateIndex: number;
  scores: Record<ImageEvalDimension, DimensionScore>;
  hardFailures: ImageEvalHardFailure[];
  issues: string[];
  suggestions: string[];
  verdict: "pass" | "reject";
  overallScore: number;
};

export type ImageEvaluationResult = {
  shots: { sortOrder: number; candidates: ImageCandidateEvaluation[] }[];
  crossShot: {
    score: number;
    selectedCandidates: { sortOrder: number; candidateIndex: number }[];
    hardFailures: ImageEvalHardFailure[];
    issues: string[];
  };
  overallScore: number;
};

export type ImageEvaluator = {
  readonly name: string;
  evaluate(
    input: ImageEvaluationPromptInput,
    context?: LlmLogContext,
  ): Promise<ImageEvaluationResult>;
};

const HTTP_TIMEOUT_MS = 120_000;

export function resolveImageEvaluator(
  settings: PlannerProviderSettings,
  readBytes: MediaBytesReader,
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ImageEvaluator {
  const apiUrl = settings.apiUrl?.trim();
  const apiKey = settings.apiKey?.trim();
  const model = settings.model?.trim();
  if (!apiUrl || !apiKey || !model) {
    return {
      name: "unconfigured",
      evaluate: () =>
        Promise.reject(new Error("image evaluator LLM is not configured")),
    };
  }
  const config = { apiUrl, apiKey, model };
  return {
    name: `llm:${config.model}`,
    async evaluate(input, context) {
      const userContent: unknown[] = [
        { type: "text", text: buildImageEvaluatorUserPrompt(input) },
      ];
      const assets = input.shots.flatMap((shot) => [
        ...shot.identityReferences.map((media) => ({
          media,
          label: `Shot ${shot.sortOrder} identity reference ${media.mediaId}`,
        })),
        ...shot.environmentReferences.map((media) => ({
          media,
          label: `Shot ${shot.sortOrder} environment reference ${media.mediaId}`,
        })),
        ...shot.candidates.map((media) => ({
          media,
          label: `Shot ${shot.sortOrder} candidate ${media.candidateIndex} media ${media.mediaId}`,
        })),
      ]);
      const imageBlocks = await Promise.all(
        assets.map(({ media, label }) =>
          readImageBlocks(readBytes, media, label),
        ),
      );
      for (const blocks of imageBlocks) {
        userContent.push(...blocks);
      }
      const requestJson = {
        model: config.model,
        messages: [
          { role: "system", content: IMAGE_EVALUATOR_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      };
      const execute = () =>
        fetchFn(config.apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestJson),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      const mediaIds = uniqueMediaIds(input);
      const response = llmLogs
        ? await llmLogs.runJsonFetch({
            type: LLM_LOG_TYPE.imageEvaluate,
            provider: "openai-compatible",
            model: config.model,
            endpoint: config.apiUrl,
            requestJson,
            context: { ...context, inputMediaIds: mediaIds },
            execute,
          })
        : await execute();
      if (!response.ok) {
        throw new Error(`image evaluator LLM failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("image evaluator LLM returned no content");
      }
      return parseImageEvaluation(
        content,
        input.shots.map((shot) => ({
          sortOrder: shot.sortOrder,
          candidateIndexes: shot.candidates.map(
            (candidate) => candidate.candidateIndex,
          ),
        })),
      );
    },
  };
}

async function readImageBlocks(
  readBytes: MediaBytesReader,
  media: ImageEvaluationMedia,
  label: string,
): Promise<unknown[]> {
  const { bytes, contentType } = await readBytes(media);
  return [
    { type: "text", text: label },
    {
      type: "image_url",
      image_url: {
        url: `data:${contentType};base64,${bytes.toString("base64")}`,
      },
    },
  ];
}

export function parseImageEvaluation(
  raw: string,
  expectedShots: { sortOrder: number; candidateIndexes: number[] }[],
): ImageEvaluationResult {
  const parsed = extractJson(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.shots)) {
    throw new Error("image evaluation is missing shots");
  }
  if (parsed.shots.length !== expectedShots.length) {
    throw new Error("image evaluation returned an unexpected shot count");
  }
  const shots = parsed.shots.map((rawShot, shotIndex) => {
    const expected = expectedShots[shotIndex];
    if (!isRecord(rawShot) || rawShot.sortOrder !== expected.sortOrder) {
      throw new Error(
        `image evaluation shot ${shotIndex} has invalid sortOrder`,
      );
    }
    if (!Array.isArray(rawShot.candidates)) {
      throw new Error(
        `image evaluation shot ${shotIndex} is missing candidates`,
      );
    }
    if (rawShot.candidates.length !== expected.candidateIndexes.length) {
      throw new Error(
        `image evaluation shot ${shotIndex} returned an unexpected candidate count`,
      );
    }
    const candidates = rawShot.candidates.map(
      (rawCandidate, candidateOffset) => {
        const candidateIndex = expected.candidateIndexes[candidateOffset];
        if (
          !isRecord(rawCandidate) ||
          rawCandidate.candidateIndex !== candidateIndex
        ) {
          throw new Error(
            `image evaluation shot ${shotIndex} has invalid candidateIndex`,
          );
        }
        if (!isRecord(rawCandidate.scores)) {
          throw new Error(
            `image evaluation shot ${shotIndex} candidate ${candidateIndex} is missing scores`,
          );
        }
        const scores = {} as Record<ImageEvalDimension, DimensionScore>;
        for (const dimension of IMAGE_EVAL_DIMENSIONS) {
          const value = rawCandidate.scores[dimension];
          if (!isRecord(value)) {
            throw new Error(
              `image evaluation shot ${shotIndex} candidate ${candidateIndex} is missing dimension ${dimension}`,
            );
          }
          scores[dimension] = validateScore(
            value,
            `image ${shotIndex}/${candidateIndex} ${dimension}`,
          );
        }
        const hardFailures = hardFailureArray(rawCandidate.hardFailures);
        const issues = stringArray(rawCandidate.issues);
        const suggestions = stringArray(rawCandidate.suggestions);
        const scoreValues = IMAGE_EVAL_DIMENSIONS.map(
          (dimension) => scores[dimension].score,
        );
        const verdict =
          hardFailures.length > 0 || Math.min(...scoreValues) <= 2
            ? "reject"
            : "pass";
        const overallScore = strictOverallScore(
          scoreValues,
          hardFailures.length > 0 ||
            issues.length > 0 ||
            suggestions.length > 0,
        );
        return {
          candidateIndex,
          scores,
          hardFailures,
          issues,
          suggestions,
          verdict,
          overallScore:
            hardFailures.length > 0
              ? Math.min(overallScore, 2.99)
              : overallScore,
        } satisfies ImageCandidateEvaluation;
      },
    );
    return { sortOrder: expected.sortOrder, candidates };
  });
  if (!isRecord(parsed.crossShot)) {
    throw new Error("image evaluation is missing crossShot");
  }
  const crossShotScore = parsed.crossShot.score;
  if (
    !Number.isInteger(crossShotScore) ||
    (crossShotScore as number) < 1 ||
    (crossShotScore as number) > 5
  ) {
    throw new Error("image evaluation crossShot has invalid score");
  }
  const selectedCandidates = selectedCandidatesArray(
    parsed.crossShot.selectedCandidates,
    expectedShots,
  );
  const crossShot = {
    score: crossShotScore as number,
    selectedCandidates,
    hardFailures: hardFailureArray(parsed.crossShot.hardFailures),
    issues: stringArray(parsed.crossShot.issues),
  };
  const bestScores = shots.map((shot) =>
    Math.max(...shot.candidates.map((candidate) => candidate.overallScore)),
  );
  const rejectedShot = shots.some((shot) =>
    shot.candidates.every((candidate) => candidate.verdict === "reject"),
  );
  const uncappedOverallScore = strictOverallScore(
    [...bestScores, crossShot.score],
    rejectedShot ||
      crossShot.hardFailures.length > 0 ||
      crossShot.issues.length > 0,
  );
  const overallScore =
    rejectedShot || crossShot.hardFailures.length > 0
      ? Math.min(uncappedOverallScore, 2.99)
      : uncappedOverallScore;
  return { shots, crossShot, overallScore };
}

function selectedCandidatesArray(
  value: unknown,
  expectedShots: { sortOrder: number; candidateIndexes: number[] }[],
) {
  if (!Array.isArray(value) || value.length !== expectedShots.length) {
    throw new Error(
      "image evaluation crossShot has invalid selectedCandidates",
    );
  }
  return value.map((entry, index) => {
    const expected = expectedShots[index];
    if (
      !isRecord(entry) ||
      entry.sortOrder !== expected.sortOrder ||
      typeof entry.candidateIndex !== "number" ||
      !expected.candidateIndexes.includes(entry.candidateIndex)
    ) {
      throw new Error(
        "image evaluation crossShot has invalid selectedCandidates",
      );
    }
    return {
      sortOrder: expected.sortOrder,
      candidateIndex: entry.candidateIndex,
    };
  });
}

function hardFailureArray(value: unknown): ImageEvalHardFailure[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (
      typeof entry !== "string" ||
      !(IMAGE_EVAL_HARD_FAILURES as readonly string[]).includes(entry)
    ) {
      throw new Error("image evaluation returned an invalid hard failure code");
    }
    return entry as ImageEvalHardFailure;
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function uniqueMediaIds(input: ImageEvaluationPromptInput): string[] {
  return [
    ...new Set(
      input.shots.flatMap((shot) => [
        ...shot.identityReferences.map((item) => item.mediaId),
        ...shot.environmentReferences.map((item) => item.mediaId),
        ...shot.candidates.map((item) => item.mediaId),
      ]),
    ),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
