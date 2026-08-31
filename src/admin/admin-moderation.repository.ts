import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { reports } from "../domain/database/schema";

export type AdminReportRecord = typeof reports.$inferSelect;

@Injectable()
export class AdminModerationRepository {
  constructor(private readonly database: DatabaseService) {}

  async hasReportCursor(
    cursorId: string,
    status?: "submitted" | "reviewing" | "resolved" | "rejected",
  ): Promise<boolean> {
    return (
      (
        await this.database.client
          .select({ id: reports.id })
          .from(reports)
          .where(
            and(
              eq(reports.id, cursorId),
              status ? eq(reports.status, status) : undefined,
            ),
          )
          .limit(1)
      ).length > 0
    );
  }

  async listReports(input: {
    status?: "submitted" | "reviewing" | "resolved" | "rejected";
    cursorId?: string;
    limit: number;
  }): Promise<AdminReportRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ createdAt: reports.createdAt, id: reports.id })
          .from(reports)
          .where(eq(reports.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select()
      .from(reports)
      .where(
        and(
          input.status ? eq(reports.status, input.status) : undefined,
          cursor
            ? or(
                lt(reports.createdAt, cursor.createdAt),
                and(
                  eq(reports.createdAt, cursor.createdAt),
                  lt(reports.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(input.limit + 1);
  }

  getReport(reportId: string): Promise<AdminReportRecord | null> {
    return this.database.client
      .select()
      .from(reports)
      .where(eq(reports.id, reportId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async updateReport(input: {
    reportId: string;
    status: "submitted" | "reviewing" | "resolved" | "rejected";
    resolution: string | null;
  }): Promise<AdminReportRecord> {
    const [row] = await this.database.client
      .update(reports)
      .set({ status: input.status, resolution: input.resolution })
      .where(eq(reports.id, input.reportId))
      .returning();
    return row;
  }
}
