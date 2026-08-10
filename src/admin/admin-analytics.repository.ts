import { Injectable } from "@nestjs/common";
import { PrismaService } from "../domain/database/prisma.service";

@Injectable()
export class AdminAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  countEvents(createdAt?: { gte?: Date; lte?: Date }) {
    return this.prisma.userEvent.count({
      where: createdAt ? { createdAt } : {},
    });
  }

  countMessages(createdAt?: { gte?: Date; lte?: Date }) {
    return this.prisma.message.count({
      where: createdAt ? { createdAt } : {},
    });
  }

  // 원장 금액은 항상 양수이고 방향은 type이 정한다. 지급은 grant 하나뿐이고
  // 차감은 사용·환불 회수·조정 셋으로 나뉘어 있어 합쳐서 센다.
  async sumCredits(
    direction: "grant" | "debit",
    createdAt?: { gte?: Date; lte?: Date },
  ): Promise<number> {
    const result = await this.prisma.creditLedger.aggregate({
      where: {
        type:
          direction === "grant"
            ? "grant"
            : { in: ["usage", "refund_recovery", "adjustment"] },
        ...(createdAt ? { createdAt } : {}),
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  countGenerationJobs(createdAt?: { gte?: Date; lte?: Date }) {
    return this.prisma.generationJob.count({
      where: createdAt ? { createdAt } : {},
    });
  }
}
