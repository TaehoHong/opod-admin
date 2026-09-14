type Operation = {
  kind: "select" | "insert" | "update" | "delete";
  set?: unknown;
  values?: unknown;
};

class QueryMock implements PromiseLike<unknown> {
  constructor(
    private readonly result: unknown,
    private readonly operation: Operation,
  ) {}

  from() {
    return this;
  }
  innerJoin() {
    return this;
  }
  leftJoin() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
    return this;
  }
  groupBy() {
    return this;
  }
  limit() {
    return this;
  }
  onConflictDoUpdate() {
    return this;
  }
  onConflictDoNothing() {
    return this;
  }
  set(value: unknown) {
    this.operation.set = value;
    return this;
  }
  values(value: unknown) {
    this.operation.values = value;
    return this;
  }
  returning() {
    return Promise.resolve(this.result);
  }
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

export function createDrizzleMock(results: unknown[] = []) {
  const queue = [...results];
  const operations: Operation[] = [];
  const execute = jest.fn(async () => queue.shift() ?? { rows: [] });
  const next = (kind: Operation["kind"]) => {
    const operation: Operation = { kind };
    operations.push(operation);
    return new QueryMock(queue.shift() ?? [], operation);
  };
  const client: Record<string, jest.Mock> = {};
  Object.assign(client, {
    select: jest.fn(() => next("select")),
    insert: jest.fn(() => next("insert")),
    update: jest.fn(() => next("update")),
    delete: jest.fn(() => next("delete")),
    execute,
    transaction: jest.fn(
      async (work: (tx: unknown) => unknown): Promise<unknown> => work(client),
    ),
  });
  return {
    database: { client },
    client,
    operations,
    enqueue(...values: unknown[]) {
      queue.push(...values);
    },
  };
}

export function sqlText(query: SQL): string {
  return new PgDialect().sqlToQuery(query).sql;
}
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
