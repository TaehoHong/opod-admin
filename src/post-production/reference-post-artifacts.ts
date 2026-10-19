import type { DraftJobRow } from "../drafts/drafts.repository";
import { isRecord } from "../shared/utils/value-utils";
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function currentReferenceOutputs(
  concept: Record<string, unknown>,
  jobs: DraftJobRow[],
) {
  const build = record(concept.generationBuild);
  const prompt = record(concept.promptBuild);
  const shots = (record(concept.referenceSelection).shots ?? []) as {
    shotId: string;
    sortOrder: number;
  }[];
  if (
    !Array.isArray(build.jobIds) ||
    build.jobIds.length !== shots.length ||
    new Set(build.jobIds).size !== shots.length ||
    !shots.length ||
    build.promptRevision !== prompt.revision
  )
    return null;
  const jobIds = build.jobIds as string[];
  const outputs = shots.map((shot, index) => {
    const job = jobs.find((item) => item.id === jobIds[index]);
    const selected = job?.outputs.filter((output) => output.selected) ?? [];
    const marker = record(record(job?.paramsJson)._referenceAgent);
    if (
      job?.status !== "completed" ||
      selected.length !== 1 ||
      marker.promptRevision !== String(prompt.revision) ||
      marker.shotId !== shot.shotId
    )
      return null;
    return {
      shotId: shot.shotId,
      sortOrder: shot.sortOrder,
      mediaId: selected[0].mediaId,
      media: { url: selected[0].media.url },
    };
  });
  return outputs.every((output) => output !== null) ? outputs : null;
}
