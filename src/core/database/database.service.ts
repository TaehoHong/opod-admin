import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type DatabaseClient = NodePgDatabase;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly client: DatabaseClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();

    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }

    this.pool = new Pool({ connectionString });
    this.client = drizzle({ client: this.pool });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
