import { Injectable, NotFoundException } from "@nestjs/common";
import { parseBigintId } from "../shared/utils/bigint-id";
import { InfluencerService } from "../influencers/influencer.service";
import { CharacterInfluencerService } from "../influencers/character-influencer.service";
import { CharacterService } from "./character.service";

@Injectable()
export class CharacterReferenceLinkService {
  constructor(
    private readonly influencers: InfluencerService,
    private readonly mappings: CharacterInfluencerService,
    private readonly characters: CharacterService,
  ) {}
  async list(characterId: string) {
    await this.characters.requireActivityCharacter(characterId);
    return this.listForCharacters([characterId]);
  }
  async listForCharacters(characterIds: string[]) {
    const mappings = await this.mappings.list(characterIds);
    const accounts = new Map(
      (
        await this.influencers.byIds(mappings.map((row) => row.influencerId))
      ).map((row) => [String(row.id), row]),
    );
    return mappings
      .map((mapping) => ({
        ...accounts.get(String(mapping.influencerId))!,
        id: String(mapping.influencerId),
        characterId: mapping.characterId,
      }))
      .sort((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0,
      );
  }
  async create(characterId: string, url: string) {
    await this.characters.requireActivityCharacter(characterId);
    const account = await this.influencers.register(url);
    await this.mappings.add(characterId, account.id);
    return { ...account, id: String(account.id), characterId };
  }
  async update(characterId: string, linkId: string, url: string) {
    await this.characters.requireActivityCharacter(characterId);
    const oldId = parseBigintId(linkId, "Invalid influencer ID");
    if (
      !(await this.mappings.list([characterId])).some(
        (row) => row.influencerId === oldId,
      )
    )
      throw new NotFoundException("Reference account not found");
    const account = await this.influencers.register(url);
    await this.mappings.replace(characterId, oldId, account.id);
    return { ...account, id: String(account.id), characterId };
  }
  async delete(characterId: string, linkId: string) {
    await this.characters.requireActivityCharacter(characterId);
    const id = parseBigintId(linkId, "Invalid influencer ID");
    await this.mappings.remove(characterId, id);
    return { id: String(id) };
  }
}
