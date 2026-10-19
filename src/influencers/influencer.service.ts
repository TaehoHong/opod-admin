import { Injectable, NotFoundException } from "@nestjs/common";
import { parseBigintId } from "../shared/utils/bigint-id";
import { decodeCursor, pageFromRows } from "../shared/utils/page";
import { InfluencerRepository } from "./influencer.repository";
import { instagramAccount } from "./influencer-input";
@Injectable()
export class InfluencerService {
  constructor(private readonly repository: InfluencerRepository) {}
  register(url: string) {
    return this.repository.register(instagramAccount(url));
  }
  async require(id: string) {
    const row = await this.repository.get(
      parseBigintId(id, "Invalid influencer ID"),
    );
    if (!row) throw new NotFoundException("Influencer not found");
    return row;
  }
  byIds(ids: bigint[]) {
    return this.repository.byIds(ids);
  }
  async list(cursor: string | undefined, limit: number) {
    const after = decodeCursor(cursor);
    return pageFromRows(
      (
        await this.repository.list(
          after ? parseBigintId(after, "Invalid cursor") : undefined,
          limit + 1,
        )
      ).map((row) => ({ ...row, id: String(row.id) })),
      limit,
    );
  }
}
