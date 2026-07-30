import { Injectable } from "@nestjs/common";
import { PrismaService } from "../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

export type PostingPolicyRow = {
  characterId: string;
  enabled: boolean;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
  updatedAt: Date;
};

export type PostingPolicyValues = Omit<
  PostingPolicyRow,
  "characterId" | "updatedAt"
>;

@Injectable()
export class PostingPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCharacter(characterId: string): Promise<PostingPolicyRow | null> {
    return this.prisma.characterPostingPolicy.findUnique({
      where: { characterId },
    });
  }

  upsert(
    characterId: string,
    values: PostingPolicyValues,
  ): Promise<PostingPolicyRow> {
    return this.prisma.characterPostingPolicy.upsert({
      where: { characterId },
      create: { characterId, ...values },
      update: values,
    });
  }

  async characterExists(characterId: string): Promise<boolean> {
    const row = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    return row !== null;
  }

  async recordPolicyChange(characterId: string, reason: string): Promise<void> {
    await this.prisma.characterActionLog.create({
      data: {
        characterId,
        actionType: "POSTING_POLICY_UPDATED",
        targetTable: "character_posting_policies",
        targetId: characterId,
        reason,
      },
    });
  }
}
