import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EVAL_RUBRIC_VERSION } from "../../../prompts/plan-evaluator";
import { EvaluationRepository } from "../../worker/evaluation.repository";
import { isRecord } from "../../worker/value-utils";

const DEFAULT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const HIGH_SCORE = 4;
const LOW_SCORE = 2;

type ScoreSample = {
  draftId: string;
  kind: "plan" | "image_plan" | "prompt" | "image";
  dimension: string;
  score: number;
};

type DimensionSummary = {
  count: number;
  average: number;
  lowScoreCount: number;
};

@Injectable()
export class EvaluationsService {
  constructor(private readonly evaluations: EvaluationRepository) {}

  async listForDraft(draftId: string) {
    return { items: await this.evaluations.findByDraft(draftId) };
  }

  async createReport(input: { from?: string; to?: string }) {
    const to = input.to ? parseDate(input.to, "to") : new Date();
    const from = input.from
      ? parseDate(input.from, "from")
      : new Date(to.getTime() - DEFAULT_PERIOD_MS);
    if (from >= to) {
      throw new BadRequestException("from must be earlier than to");
    }

    const rows = await this.evaluations.findCompletedInPeriod({
      from,
      to,
      rubricVersion: EVAL_RUBRIC_VERSION,
    });
    const languages = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = languages.get(row.contentLanguage) ?? [];
      group.push(row);
      languages.set(row.contentLanguage, group);
    }

    const languageSummaries = Object.fromEntries(
      [...languages.entries()].map(([language, evaluations]) => [
        language,
        summarizeLanguage(evaluations),
      ]),
    );
    const failurePatterns = [...languages.entries()]
      .flatMap(([language, evaluations]) =>
        failurePatternsFor(language, scoreSamples(evaluations)),
      )
      .sort((left, right) => right.lowScoreCount - left.lowScoreCount);

    return this.evaluations.createReport({
      periodStart: from,
      periodEnd: to,
      rubricVersion: EVAL_RUBRIC_VERSION,
      summaryJson: {
        evaluationCount: rows.length,
        languages: languageSummaries,
      },
      failurePatternsJson: failurePatterns,
    });
  }

  async listReports(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException(
        "limit must be an integer between 1 and 100",
      );
    }
    return { items: await this.evaluations.listReports(limit) };
  }

  async getReport(id: string) {
    const report = await this.evaluations.findReport(id);
    if (!report) {
      throw new NotFoundException("Evaluation report not found");
    }
    return report;
  }
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }
  return parsed;
}

function summarizeLanguage(
  rows: Awaited<ReturnType<EvaluationRepository["findCompletedInPeriod"]>>,
) {
  const samples = scoreSamples(rows);
  const dimensions = new Map<string, number[]>();
  for (const sample of samples) {
    const key = `${sample.kind}.${sample.dimension}`;
    const values = dimensions.get(key) ?? [];
    values.push(sample.score);
    dimensions.set(key, values);
  }

  const approved = new Set<string>();
  const rejected = new Set<string>();
  const regeneratedShots = new Set<string>();
  const selectedOutputs = new Set<string>();
  const captionEdited = new Set<string>();
  for (const row of rows) {
    if (row.draft.status === "rejected") rejected.add(row.draftId);
    if (row.draft.status === "approved" || row.draft.status === "published") {
      approved.add(row.draftId);
    }
    for (const job of row.draft.jobs) {
      if (job.originJobId)
        regeneratedShots.add(`${row.draftId}:${job.sortOrder}`);
      if (job.outputs.some((output) => output.selected))
        selectedOutputs.add(job.id);
    }
    const plan = isRecord(row.draft.conceptJson)
      ? row.draft.conceptJson.plan
      : undefined;
    if (
      isRecord(plan) &&
      typeof plan.caption === "string" &&
      plan.caption.trim() !== row.draft.caption.trim()
    ) {
      captionEdited.add(row.draftId);
    }
  }

  const highScoreRejected = uniqueIds(
    rows.filter(
      (row) =>
        row.draft.status === "rejected" &&
        (row.overallScore ?? 0) >= HIGH_SCORE,
    ),
  );
  const lowScoreApproved = uniqueIds(
    rows.filter(
      (row) =>
        (row.draft.status === "approved" || row.draft.status === "published") &&
        (row.overallScore ?? 6) <= LOW_SCORE,
    ),
  );

  return {
    evaluationCount: rows.length,
    byKind: {
      plan: rows.filter((row) => row.kind === "plan").length,
      imagePlan: rows.filter((row) => row.kind === "image_plan").length,
      prompt: rows.filter((row) => row.kind === "prompt").length,
      image: rows.filter((row) => row.kind === "image").length,
    },
    dimensions: Object.fromEntries(
      [...dimensions.entries()].map(([dimension, values]) => [
        dimension,
        dimensionSummary(values),
      ]),
    ),
    humanSignals: {
      approvedDrafts: approved.size,
      rejectedDrafts: rejected.size,
      regeneratedShots: regeneratedShots.size,
      selectedOutputs: selectedOutputs.size,
      captionEditedDrafts: captionEdited.size,
    },
    mismatches: { highScoreRejected, lowScoreApproved },
  };
}

function dimensionSummary(values: number[]): DimensionSummary {
  return {
    count: values.length,
    average: round2(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ),
    lowScoreCount: values.filter((value) => value <= LOW_SCORE).length,
  };
}

function scoreSamples(
  rows: Awaited<ReturnType<EvaluationRepository["findCompletedInPeriod"]>>,
): ScoreSample[] {
  return rows.flatMap((row) =>
    scoresFromJson(row.kind, row.scoresJson).map((entry) => ({
      draftId: row.draftId,
      kind: row.kind,
      ...entry,
    })),
  );
}

function scoresFromJson(
  kind: "plan" | "image_plan" | "prompt" | "image",
  value: unknown,
): { dimension: string; score: number }[] {
  if (!isRecord(value)) return [];
  if (kind === "plan" || kind === "image_plan") {
    return isRecord(value.scores) ? scoresFromRecord(value.scores) : [];
  }
  const shots = Array.isArray(value.shots) ? value.shots : [];
  const shotScores = shots.flatMap((shot) => {
    if (!isRecord(shot)) return [];
    if (kind === "image") {
      const candidates = Array.isArray(shot.candidates) ? shot.candidates : [];
      return candidates.flatMap((candidate) =>
        isRecord(candidate) && isRecord(candidate.scores)
          ? scoresFromRecord(candidate.scores)
          : [],
      );
    }
    return isRecord(shot.scores) ? scoresFromRecord(shot.scores) : [];
  });
  const crossShot = isRecord(value.crossShot)
    ? value.crossShot.score
    : undefined;
  return Number.isFinite(crossShot)
    ? [
        ...shotScores,
        { dimension: "cross_shot_consistency", score: crossShot as number },
      ]
    : shotScores;
}

function scoresFromRecord(value: Record<string, unknown>) {
  return Object.entries(value).flatMap(([dimension, entry]) =>
    isRecord(entry) && Number.isFinite(entry.score)
      ? [{ dimension, score: entry.score as number }]
      : [],
  );
}

function failurePatternsFor(language: string, samples: ScoreSample[]) {
  const grouped = new Map<string, ScoreSample[]>();
  for (const sample of samples.filter((entry) => entry.score <= LOW_SCORE)) {
    const key = `${sample.kind}.${sample.dimension}`;
    const values = grouped.get(key) ?? [];
    values.push(sample);
    grouped.set(key, values);
  }
  return [...grouped.entries()].map(([key, values]) => {
    const [kind, ...dimension] = key.split(".");
    return {
      language,
      kind,
      dimension: dimension.join("."),
      lowScoreCount: values.length,
      exampleDraftIds: [...new Set(values.map((value) => value.draftId))].slice(
        0,
        10,
      ),
    };
  });
}

function uniqueIds(rows: { draftId: string }[]) {
  return [...new Set(rows.map((row) => row.draftId))].slice(0, 20);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
