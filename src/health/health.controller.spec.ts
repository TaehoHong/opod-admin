import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

function createController(databaseReachable: boolean) {
  const controller = new HealthController(
    new HealthService({
      isDatabaseReachable: () => Promise.resolve(databaseReachable),
    } as never),
  );
  const statuses: number[] = [];
  return {
    controller,
    statuses,
    response: { status: (code: number) => statuses.push(code) },
  };
}

describe("HealthController", () => {
  // 항상 200을 주는 health 경로는 없는 것보다 나쁘다 — DB가 끊겨도 정상으로
  // 보이므로 모니터링이 장애를 놓친다.
  it("maps database reachability onto the response status", async () => {
    const up = createController(true);
    await expect(up.controller.check(up.response)).resolves.toEqual({
      status: "ok",
      database: "up",
    });
    expect(up.statuses).toEqual([200]);

    const down = createController(false);
    await expect(down.controller.check(down.response)).resolves.toEqual({
      status: "degraded",
      database: "down",
    });
    expect(down.statuses).toEqual([503]);
  });
});
