import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export type GenerationSettingRow = {
  key: string;
  value: string;
};

@Injectable()
export class GenerationSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByKeys(keys: string[]): Promise<GenerationSettingRow[]> {
    return this.prisma.adminSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
  }

  async upsertValue(key: string, value: string): Promise<void> {
    await this.prisma.adminSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async deleteByKey(key: string): Promise<void> {
    await this.prisma.adminSetting.deleteMany({ where: { key } });
  }
}
