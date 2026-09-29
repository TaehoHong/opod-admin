import { Injectable } from "@nestjs/common";
import {
  CharacterContentProfile,
  EMPTY_CONTENT_PROFILE,
} from "./character-content-profile";
import { CharacterContentProfileRepository } from "./character-content-profile.repository";

@Injectable()
export class CharacterContentProfileService {
  constructor(private readonly profiles: CharacterContentProfileRepository) {}

  async get(characterId: string): Promise<CharacterContentProfile> {
    return (
      (await this.profiles.find(characterId)) ?? { ...EMPTY_CONTENT_PROFILE }
    );
  }

  put(characterId: string, profile: CharacterContentProfile) {
    return this.profiles.put(characterId, profile);
  }
}
