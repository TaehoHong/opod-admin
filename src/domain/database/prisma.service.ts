import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();

    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }

    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
