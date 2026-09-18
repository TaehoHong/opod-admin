import { BadRequestException, Injectable } from "@nestjs/common";
import { PostingPolicyRepository } from "./posting-policy.repository";

type PostingPolicy = {
  characterId: string;
  enabled: boolean;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
  updatedAt?: string;
  lastRun: {
    status: string;
    scheduledAt: string;
    finishedAt: string | null;
    attemptCount: number;
    errorMessage: string | null;
  } | null;
};

const CADENCE_MIN = 1;
const CADENCE_MAX = 21;

// 캐릭터 자동 포스팅 정책. 드래프트 워커 스케줄러의 입력이다.
@Injectable()
export class PostingPolicyService {
  constructor(private readonly policies: PostingPolicyRepository) {}

  async getPolicy(characterId: string): Promise<PostingPolicy> {
    await this.assertCharacter(characterId);
    const [policy, lastRun] = await Promise.all([
      this.policies.findByCharacter(characterId),
      this.policies.findLatestRun(characterId),
    ]);
    if (!policy) {
      return {
        characterId,
        enabled: false,
        weeklyCadence: 3,
        hourStartKst: 18,
        hourEndKst: 22,
        lastRun: this.toLastRun(lastRun),
      };
    }
    return { ...this.toPolicy(policy), lastRun: this.toLastRun(lastRun) };
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
    const policy = await this.policies.upsert(input.characterId, data);
    await this.policies.recordPolicyChange(
      input.characterId,
      `posting policy ${enabled ? "enabled" : "disabled"} (${weeklyCadence}/week, ${hourStartKst}-${hourEndKst} KST)`,
    );
    return { ...this.toPolicy(policy), lastRun: null };
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
    if (!(await this.policies.characterExists(characterId))) {
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
  }): Omit<PostingPolicy, "lastRun"> {
    return {
      characterId: policy.characterId,
      enabled: policy.enabled,
      weeklyCadence: policy.weeklyCadence,
      hourStartKst: policy.hourStartKst,
      hourEndKst: policy.hourEndKst,
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  private toLastRun(
    run: Awaited<ReturnType<PostingPolicyRepository["findLatestRun"]>>,
  ): PostingPolicy["lastRun"] {
    return run
      ? {
          status: run.processingStatus,
          scheduledAt: run.scheduledAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          attemptCount: run.attemptCount,
          errorMessage: run.lastErrorMessage,
        }
      : null;
  }
}
