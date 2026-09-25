import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseClient } from "./database.service";

export type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

type TransactionScope = {
  transaction: DatabaseTransaction;
  characterId: string;
  active: boolean;
};

@Injectable()
export class DatabaseTransactionContext {
  private readonly storage = new AsyncLocalStorage<TransactionScope>();

  async run<T>(
    transaction: DatabaseTransaction,
    characterId: string,
    callback: () => Promise<T>,
  ) {
    const scope: TransactionScope = { transaction, characterId, active: true };
    try {
      return await this.storage.run(scope, callback);
    } finally {
      scope.active = false;
    }
  }

  currentOr(database: DatabaseClient): DatabaseClient | DatabaseTransaction {
    const scope = this.storage.getStore();
    if (!scope) return database;
    if (!scope.active)
      throw new Error("database transaction scope has completed");
    return scope.transaction;
  }

  current(): TransactionScope | undefined {
    const scope = this.storage.getStore();
    if (scope && !scope.active) {
      throw new Error("database transaction scope has completed");
    }
    return scope;
  }
}
