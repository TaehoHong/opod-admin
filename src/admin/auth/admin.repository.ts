import { Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DatabaseService } from "../../domain/database/database.service";
import { admins } from "../../domain/database/schema";

// entity repository — DatabaseService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

export type AdminAccount = {
  id: string;
  email: string;
  isEnabled: boolean;
  isDeleted: boolean;
  createdAt: Date;
};

export type AdminAccountWithPassword = AdminAccount & { password: string };

const withPassword = {
  id: admins.id,
  email: admins.email,
  password: admins.password,
  isEnabled: admins.isEnabled,
  isDeleted: admins.isDeleted,
  createdAt: admins.createdAt,
} as const;

const publicFields = {
  id: admins.id,
  email: admins.email,
  isEnabled: admins.isEnabled,
  isDeleted: admins.isDeleted,
  createdAt: admins.createdAt,
} as const;

export class DuplicateAdminEmailError extends Error {}

@Injectable()
export class AdminRepository {
  constructor(private readonly database: DatabaseService) {}

  async countAll(): Promise<number> {
    const [row] = await this.database.client
      .select({ value: count() })
      .from(admins);
    return row?.value ?? 0;
  }

  findByEmailWithPassword(
    email: string,
  ): Promise<AdminAccountWithPassword | null> {
    return this.database.client
      .select(withPassword)
      .from(admins)
      .where(eq(admins.email, email))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  findById(id: string): Promise<AdminAccount | null> {
    return this.database.client
      .select(publicFields)
      .from(admins)
      .where(eq(admins.id, id))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  // PostgreSQL 오류 코드가 service로 새지 않도록 도메인 오류로 바꾼다.
  async create(input: {
    email: string;
    password: string;
  }): Promise<AdminAccount> {
    try {
      const [row] = await this.database.client
        .insert(admins)
        .values({
          email: input.email,
          password: input.password,
          isEnabled: true,
          isDeleted: false,
        })
        .returning(publicFields);
      return row;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      if (
        (error as { code?: string }).code === "23505" ||
        cause?.code === "23505"
      ) {
        throw new DuplicateAdminEmailError(input.email);
      }
      throw error;
    }
  }
}
