import { Injectable } from "@nestjs/common";
import { CharacterService } from "./character.service";
import { CharacterSocialActivityJobService } from "./character-social-activity-job.service";
import { CharacterSocialActivityPolicyService } from "./character-social-activity-policy.service";
import { UpsertSocialActivityPolicyDto } from "./dto/upsert-social-activity-policy.dto";

@Injectable()
export class CharacterSocialActivityApplicationService {
  constructor(
    private readonly characters: CharacterService,
    private readonly policies: CharacterSocialActivityPolicyService,
    private readonly jobs: CharacterSocialActivityJobService,
  ) {}

  async get(characterId: string) {
    const [character, policy, latestJob] = await Promise.all([
      this.characters.requireActivityCharacter(characterId),
      this.policies.find(characterId),
      this.jobs.findLatest(characterId),
    ]);
    return this.toResponse(character, policy, latestJob);
  }

  async put(characterId: string, input: UpsertSocialActivityPolicyDto) {
    await this.characters.withActivityTransaction(characterId, async () => {
      await this.policies.upsert(characterId, input);
      if (!input.enabled) await this.jobs.cancelActive(characterId);
    });
    return this.get(characterId);
  }

  async updateCharacter(input: {
    id: string;
    displayName?: string;
    bio?: string;
    interests?: string[];
    timezone?: string | null;
  }) {
    return this.characters.withActivityTransaction(input.id, async () => {
      await this.policies.assertTimezoneChangeAllowed(input.id, input.timezone);
      return this.characters.updateCharacter(input);
    });
  }

  async updateCharacterStatus(input: {
    id: string;
    status: string;
    reason: string;
  }) {
    return this.characters.withActivityTransaction(input.id, async () => {
      if (input.status === "inactive") {
        await this.policies.disable(input.id);
        await this.jobs.cancelActive(input.id);
      }
      return this.characters.updateCharacterStatus(input);
    });
  }

  private toResponse(
    character: Awaited<
      ReturnType<CharacterService["requireActivityCharacter"]>
    >,
    policy: Awaited<ReturnType<CharacterSocialActivityPolicyService["find"]>>,
    latestJob: Awaited<
      ReturnType<CharacterSocialActivityJobService["findLatest"]>
    >,
  ) {
    return {
      characterId: character.id,
      status: character.status,
      timezone: character.timezone,
      policy: policy
        ? {
            ...policy,
            postLikeProbability: Number(policy.postLikeProbability),
            nextActivityAt: policy.nextActivityAt?.toISOString() ?? null,
            createdAt: policy.createdAt.toISOString(),
            updatedAt: policy.updatedAt.toISOString(),
          }
        : null,
      latestJob: latestJob
        ? {
            ...latestJob,
            id: latestJob.id.toString(),
            scheduledAt: latestJob.scheduledAt.toISOString(),
            finishedAt: latestJob.finishedAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}
