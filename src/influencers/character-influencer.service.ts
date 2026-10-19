import { Injectable, NotFoundException } from "@nestjs/common";
import { CharacterInfluencerRepository } from "./character-influencer.repository";
@Injectable()
export class CharacterInfluencerService {
  constructor(private readonly repository: CharacterInfluencerRepository) {}
  list(ids: string[]) {
    return this.repository.list(ids);
  }
  add(characterId: string, influencerId: bigint) {
    return this.repository.add(characterId, influencerId);
  }
  async remove(characterId: string, influencerId: bigint) {
    if (!(await this.repository.remove(characterId, influencerId)))
      throw new NotFoundException("Reference account not found");
  }
  async replace(characterId: string, oldId: bigint, newId: bigint) {
    if (!(await this.repository.replace(characterId, oldId, newId)))
      throw new NotFoundException("Reference account not found");
  }
}
