import { ConflictException, Injectable } from "@nestjs/common";
import { assertReferenceEmbedding } from "../shared/ai/reference-embedding";
import {
  InfluencerMediaRepository,
  InfluencerMediaRow,
  MediaFilter,
  MediaWrite,
  ReferenceMediaSearch,
} from "./influencer-media.repository";
@Injectable()
export class InfluencerMediaService {
  constructor(private readonly repository: InfluencerMediaRepository) {}
  searchReferences(input: ReferenceMediaSearch) {
    assertReferenceEmbedding(input.embedding);
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 12)
    )
      throw new Error("reference_candidate_limit_invalid");
    return this.repository.searchReferences(input);
  }
  async findReadSources(
    influencerIds: bigint[],
    sources: { mediaId: string; sha256: string }[],
  ) {
    const rows = await this.repository.findReadSources(
      influencerIds,
      sources.map((source) => BigInt(source.mediaId)),
    );
    return sources.map((source) => {
      const row = rows.find(
        (item) =>
          String(item.id) === source.mediaId && item.sha256 === source.sha256,
      );
      if (!row) throw new ConflictException("reference_source_changed");
      return row;
    });
  }
  find(value: { influencerId: bigint; postId: string; slideIndex: number }) {
    return this.repository.find(value);
  }
  register(value: MediaWrite) {
    return this.repository.register(value);
  }
  async saveComposition(
    row: InfluencerMediaRow,
    analysis: Record<string, string | number | null>,
    model: string,
    version: string,
  ) {
    const saved = await this.repository.saveComposition(
      row,
      analysis,
      model,
      version,
    );
    if (!saved) throw new ConflictException("analysis_changed");
    return saved;
  }
  list(input: MediaFilter) {
    return this.repository.list(input);
  }
  async prepareEmbedding(row: InfluencerMediaRow, model: string) {
    const current = await this.repository.prepareEmbedding(row, model);
    if (!current) throw new ConflictException("analysis_changed");
    return current;
  }
  async saveEmbedding(
    row: InfluencerMediaRow,
    model: string,
    vector: number[],
  ) {
    assertReferenceEmbedding(vector);
    if (!(await this.repository.saveEmbedding(row, model, vector)))
      throw new ConflictException("analysis_changed");
  }
}
