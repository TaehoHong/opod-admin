import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../domain/database/prisma.service";

type PostingPolicy = {
  characterId: string;
  enabled: boolean;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
  updatedAt?: string;
};

const CADENCE_MIN = 1;
const CADENCE_MAX = 21;

// 캐릭터 자동 포스팅 정책. 드래프트 워커 스케줄러의 입력이다.
@Injectable()
export class PostingPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(characterId: string): Promise<PostingPolicy> {
    await this.assertCharacter(characterId);
    const policy = await this.prisma.characterPostingPolicy.findUnique({
      where: { characterId },
    });
    if (!policy) {
      return {
        characterId,
        enabled: false,
        weeklyCadence: 3,
        hourStartKst: 18,
        hourEndKst: 22,
      };
    }
    return this.toPolicy(policy);
  }

  async upsertPolicy(input: {
    characterId: string;
    enabled?: boolean;
    weeklyCadence?: number;
    hourStartKst?: number;
    hourEndKst?: number;
  }): Promise<PostingPolicy> {
    await this.assertCharacter(input.characterId);
    const enabled = input.enabled ?? false;
    const weeklyCadence = this.parseIntInRange(
      input.weeklyCadence ?? 3,
      CADENCE_MIN,
      CADENCE_MAX,
      "weeklyCadence",
    );
    const hourStartKst = this.parseIntInRange(
      input.hourStartKst ?? 18,
      0,
      23,
      "hourStartKst",
    );
    const hourEndKst = this.parseIntInRange(
      input.hourEndKst ?? 22,
      0,
      23,
      "hourEndKst",
    );
    if (hourStartKst >= hourEndKst) {
      throw new BadRequestException(
        "hourStartKst must be earlier than hourEndKst",
      );
    }

    const data = { enabled, weeklyCadence, hourStartKst, hourEndKst };
    const policy = await this.prisma.characterPostingPolicy.upsert({
      where: { characterId: input.characterId },
      create: { characterId: input.characterId, ...data },
      update: data,
    });
    await this.prisma.characterActionLog.create({
      data: {
        characterId: input.characterId,
        actionType: "POSTING_POLICY_UPDATED",
        targetTable: "character_posting_policies",
        targetId: input.characterId,
        reason: `posting policy ${enabled ? "enabled" : "disabled"} (${weeklyCadence}/week, ${hourStartKst}-${hourEndKst} KST)`,
      },
    });
    return this.toPolicy(policy);
  }

  private parseIntInRange(
    value: number,
    min: number,
    max: number,
    label: string,
  ): number {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(
        `${label} must be an integer between ${min} and ${max}`,
      );
    }
    return value;
  }

  private async assertCharacter(characterId: string): Promise<void> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!character) {
      throw new BadRequestException("Character not found");
    }
  }

  private toPolicy(policy: {
    characterId: string;
    enabled: boolean;
    weeklyCadence: number;
    hourStartKst: number;
    hourEndKst: number;
    updatedAt: Date;
  }): PostingPolicy {
    return {
      characterId: policy.characterId,
      enabled: policy.enabled,
      weeklyCadence: policy.weeklyCadence,
      hourStartKst: policy.hourStartKst,
      hourEndKst: policy.hourEndKst,
      updatedAt: policy.updatedAt.toISOString(),
    };
  }
}
