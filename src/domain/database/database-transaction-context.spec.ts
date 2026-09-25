import { DatabaseTransactionContext } from "./database-transaction-context";
import type { DatabaseTransaction } from "./database-transaction-context";
import type { DatabaseClient } from "./database.service";

describe("DatabaseTransactionContext", () => {
  it("rejects access from an async child after its transaction completes", async () => {
    const context = new DatabaseTransactionContext();
    const transaction = {} as DatabaseTransaction;
    const database = {} as DatabaseClient;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let late!: Promise<unknown>;

    await context.run(transaction, "character-1", async () => {
      expect(context.currentOr(database)).toBe(transaction);
      late = gate.then(() => context.currentOr(database));
    });
    release();
    await expect(late).rejects.toThrow(
      "database transaction scope has completed",
    );
  });
});
