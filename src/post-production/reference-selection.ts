import { isRecord } from "../shared/utils/value-utils";

export interface ReferenceCandidate {
  mediaId: string;
  sha256: string;
}

export type ReferenceSelectionDecision = {
  status: "selected" | "no_match";
  selections: { mediaId: string }[];
  shortfallReason: string;
};

export interface ReferenceSelectionDependencies<T extends ReferenceCandidate> {
  retrieveCandidates(input: {
    limit: number;
    excludedMediaIds: string[];
    excludedSha256: string[];
  }): Promise<readonly T[]>;
  selectCandidates(candidates: readonly T[]): Promise<unknown>;
}

export interface ReferenceSelectionAttempt<T extends ReferenceCandidate> {
  candidates: T[];
  decision: ReferenceSelectionDecision | null;
}

export async function selectReferences<T extends ReferenceCandidate>(
  dependencies: ReferenceSelectionDependencies<T>,
  options: { maxAttempts?: number } = {},
): Promise<{
  status: "selected" | "no_match" | "no_candidates";
  selectedCandidates: T[];
  attempts: ReferenceSelectionAttempt<T>[];
}> {
  const maxAttempts = options.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("reference selection maxAttempts must be 1 to 3");
  }
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  const attempts: ReferenceSelectionAttempt<T>[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retrieved = await dependencies.retrieveCandidates({
      limit: 12,
      excludedMediaIds: [...seenIds],
      excludedSha256: [...seenHashes],
    });
    const candidates: T[] = [];
    for (const candidate of retrieved) {
      if (candidates.length === 12) break;
      if (seenIds.has(candidate.mediaId) || seenHashes.has(candidate.sha256)) {
        continue;
      }
      seenIds.add(candidate.mediaId);
      seenHashes.add(candidate.sha256);
      candidates.push(candidate);
    }
    if (candidates.length === 0) {
      attempts.push({ candidates, decision: null });
      return { status: "no_candidates", selectedCandidates: [], attempts };
    }
    const decision = parseReferenceSelectionDecision(
      await dependencies.selectCandidates(candidates),
      candidates,
    );
    attempts.push({ candidates, decision });
    if (decision.status === "selected") {
      return {
        status: "selected",
        selectedCandidates: decision.selections.map((selection) =>
          candidates.find((item) => item.mediaId === selection.mediaId)!,
        ),
        attempts,
      };
    }
  }
  return { status: "no_match", selectedCandidates: [], attempts };
}

export function parseReferenceSelectionDecision(
  value: unknown,
  candidates: readonly ReferenceCandidate[],
): ReferenceSelectionDecision {
  if (
    !isRecord(value) ||
    (value.status !== "selected" && value.status !== "no_match") ||
    !Array.isArray(value.selections) ||
    typeof value.shortfallReason !== "string"
  ) {
    throw new Error("invalid reference selection response");
  }
  if (
    value.status === "no_match" &&
    (value.selections.length !== 0 || !value.shortfallReason.trim())
  ) {
    throw new Error("no_match requires empty selections and a reason");
  }
  if (
    value.status === "selected" &&
    (value.selections.length < 1 || value.selections.length > 3)
  ) {
    throw new Error("reference selection requires 1 to 3 selections");
  }
  const selectedIds = new Set<string>();
  const selectedHashes = new Set<string>();
  const selections = value.selections.map((selection: unknown) => {
    if (!isRecord(selection) || typeof selection.mediaId !== "string") {
      throw new Error("invalid reference selection entry");
    }
    const candidate = candidates.find(
      (item) => item.mediaId === selection.mediaId,
    );
    if (
      !candidate ||
      selectedIds.has(candidate.mediaId) ||
      selectedHashes.has(candidate.sha256)
    ) {
      throw new Error(
        "reference selection contains unknown or duplicate media",
      );
    }
    selectedIds.add(candidate.mediaId);
    selectedHashes.add(candidate.sha256);
    return { mediaId: selection.mediaId };
  });
  return {
    status: value.status,
    selections,
    shortfallReason: value.shortfallReason,
  };
}
