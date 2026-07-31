import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

export type AdminReportRecord =
  Prisma.ReportGetPayload<Prisma.ReportDefaultArgs>;

@Injectable()
export class AdminModerationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasReportCursor(
    cursorId: string,
    status?: "submitted" | "reviewing" | "resolved" | "rejected",
  ): Promise<boolean> {
    return (
      (await this.prisma.report.findFirst({
        where: { id: cursorId, ...(status ? { status } : {}) },
        select: { id: true },
      })) !== null
    );
  }

  listReports(input: {
    status?: "submitted" | "reviewing" | "resolved" | "rejected";
    cursorId?: string;
    limit: number;
  }): Promise<AdminReportRecord[]> {
    return this.prisma.report.findMany({
      where: input.status ? { status: input.status } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  getReport(reportId: string): Promise<AdminReportRecord | null> {
    return this.prisma.report.findUnique({ where: { id: reportId } });
  }

  updateReport(input: {
    reportId: string;
    status: "submitted" | "reviewing" | "resolved" | "rejected";
    resolution: string | null;
  }): Promise<AdminReportRecord> {
    return this.prisma.report.update({
      where: { id: input.reportId },
      data: { status: input.status, resolution: input.resolution },
    });
  }
}
