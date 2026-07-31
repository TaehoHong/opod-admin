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

  async sumCredits(
    entryType: "grant" | "debit",
    createdAt?: { gte?: Date; lte?: Date },
  ): Promise<number> {
    const result = await this.prisma.creditLedgerEntry.aggregate({
      where: { entryType, ...(createdAt ? { createdAt } : {}) },
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
