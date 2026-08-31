import { createDrizzleMock } from "../../test/drizzle-mock";
import { AdminCreditPaymentRepository } from "./admin-credit-payment.repository";

describe("AdminCreditPaymentRepository", () => {
  it("사용자와 멱등성 참조 advisory lock을 같은 트랜잭션에서 잡는다", async () => {
    const mock = createDrizzleMock([{ rows: [] }, { rows: [] }]);
    const repository = new AdminCreditPaymentRepository(mock.database as never);
    const work = jest.fn(async () => "done");

    await expect(
      repository.withReconciliationTransaction("user-1", "ref-1", work),
    ).resolves.toBe("done");

    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.client.execute).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
