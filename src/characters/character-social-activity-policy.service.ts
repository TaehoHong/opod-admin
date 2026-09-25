import { BadRequestException, Injectable } from "@nestjs/common";
import {
  CharacterSocialActivityPolicyRepository,
  CharacterSocialActivityPolicyValues,
} from "./character-social-activity-policy.repository";
import { CharacterService } from "./character.service";

@Injectable()
export class CharacterSocialActivityPolicyService {
  constructor(
    private readonly policies: CharacterSocialActivityPolicyRepository,
    private readonly characters: CharacterService,
  ) {}

  find(characterId: string) {
    return this.policies.find(characterId);
  }

  async upsert(
    characterId: string,
    input: Omit<CharacterSocialActivityPolicyValues, "postLikeProbability"> & {
      postLikeProbability: number;
    },
  ) {
    const activeStartLocalTime = this.normalizeLocalTime(
      input.activeStartLocalTime,
    );
    const activeEndLocalTime = this.normalizeLocalTime(
      input.activeEndLocalTime,
    );
    if (activeStartLocalTime === activeEndLocalTime) {
      throw new BadRequestException("active local times must differ");
    }
    const values: CharacterSocialActivityPolicyValues = {
      ...input,
      activeStartLocalTime,
      activeEndLocalTime,
      postLikeProbability: input.postLikeProbability.toFixed(3),
    };
    if (values.enabled) {
      await this.characters.assertCanEnableSocialActivity(characterId);
    } else {
      await this.characters.requireActivityCharacter(characterId);
    }
    const existing = await this.policies.find(characterId);
    const nextActivityAt = values.enabled
      ? existing?.enabled && existing.nextActivityAt
        ? existing.nextActivityAt
        : new Date()
      : null;
    return this.policies.upsert(characterId, values, nextActivityAt);
  }

  async assertTimezoneChangeAllowed(
    characterId: string,
    timezone?: string | null,
  ) {
    if (timezone !== null) return;
    const policy = await this.policies.find(characterId);
    if (policy?.enabled) {
      throw new BadRequestException(
        "enabled social activity requires a character timezone",
      );
    }
  }

  disable(characterId: string) {
    return this.policies.disable(characterId);
  }

  private normalizeLocalTime(value: string) {
    return value.length === 5 ? `${value}:00` : value;
  }
}
