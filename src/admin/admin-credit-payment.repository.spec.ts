import { AdminCreditPaymentRepository } from "./admin-credit-payment.repository";

describe("AdminCreditPaymentRepository", () => {
  it("serializes reconciliation by both user and idempotency reference", async () => {
    const executeRaw = jest.fn().mockResolvedValue(0);
    const transactionClient = { $executeRaw: executeRaw };
    const prisma = {
      $transaction: jest.fn(async (work: (tx: object) => Promise<unknown>) =>
        work(transactionClient),
      ),
    };
    const repository = new (
      AdminCreditPaymentRepository as unknown as new (
        prisma: object,
      ) => AdminCreditPaymentRepository
    )(prisma);
    const work = jest.fn().mockResolvedValue("done");

    await expect(
      repository.withReconciliationTransaction(
        "human-1",
        "repair-purchase-1",
        work,
      ),
    ).resolves.toBe("done");

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw.mock.calls[0][1]).toBe("human-1");
    expect(executeRaw.mock.calls[1][1]).toBe(
      "credit_reconciliation:repair-purchase-1",
    );
    expect(work).toHaveBeenCalledTimes(1);
  });
});
