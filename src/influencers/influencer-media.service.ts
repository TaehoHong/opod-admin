import { ConflictException, Injectable } from "@nestjs/common";
import { assertReferenceEmbedding } from "../shared/ai/reference-embedding";
import {
  InfluencerMediaRepository,
  InfluencerMediaRow,
  MediaFilter,
  MediaWrite,
} from "./influencer-media.repository";
@Injectable()
export class InfluencerMediaService {
  constructor(private readonly repository: InfluencerMediaRepository) {}
  find(value: { influencerId: bigint; postId: string; slideIndex: number }) {
    return this.repository.find(value);
  }
  register(value: MediaWrite) {
    return this.repository.register(value);
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
