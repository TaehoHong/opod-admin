import { Injectable } from "@nestjs/common";
import { count } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { admins } from "../domain/database/schema";

// entity repository — DatabaseService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").
@Injectable()
export class HealthRepository {
  constructor(private readonly database: DatabaseService) {}

  // 연결과 schema 접근을 함께 확인하는 최소 질의. raw SQL을 쓰지 않고도
  // 커넥션 풀과 admin 테이블 가용성을 증명한다.
  async isDatabaseReachable(): Promise<boolean> {
    try {
      await this.database.client.select({ value: count() }).from(admins);
      return true;
    } catch {
      return false;
    }
  }
}
