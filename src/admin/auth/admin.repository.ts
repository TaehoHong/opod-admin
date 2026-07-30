import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
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
  id: true,
  email: true,
  password: true,
  isEnabled: true,
  isDeleted: true,
  createdAt: true,
} as const;

const publicFields = {
  id: true,
  email: true,
  isEnabled: true,
  isDeleted: true,
  createdAt: true,
} as const;

export class DuplicateAdminEmailError extends Error {}

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  countAll(): Promise<number> {
    return this.prisma.admin.count();
  }

  findByEmailWithPassword(
    email: string,
  ): Promise<AdminAccountWithPassword | null> {
    return this.prisma.admin.findUnique({
      where: { email },
      select: withPassword,
    }) as Promise<AdminAccountWithPassword | null>;
  }

  findById(id: string): Promise<AdminAccount | null> {
    return this.prisma.admin.findUnique({
      where: { id },
      select: publicFields,
    }) as Promise<AdminAccount | null>;
  }

  // Prisma 오류 코드가 service로 새지 않도록 도메인 오류로 바꾼다.
  async create(input: {
    email: string;
    password: string;
  }): Promise<AdminAccount> {
    try {
      return await this.prisma.admin.create({
        data: {
          email: input.email,
          password: input.password,
          isEnabled: true,
          isDeleted: false,
        },
        select: publicFields,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new DuplicateAdminEmailError(input.email);
      }
      throw error;
    }
  }
}
