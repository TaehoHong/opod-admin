import { UnauthorizedException } from "@nestjs/common";
import { AdminApiKeyGuard } from "./admin-api-key.guard";

const contextWithHeader = (value?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === "x-admin-api-key" ? value : undefined,
      }),
    }),
  }) as never;

describe("AdminApiKeyGuard", () => {
  it("accepts the configured admin API key", () => {
    const guard = new AdminApiKeyGuard({ ADMIN_API_KEY: "secret" });

    expect(guard.canActivate(contextWithHeader("secret"))).toBe(true);
  });

  it("rejects missing or wrong admin API keys", () => {
    const guard = new AdminApiKeyGuard({ ADMIN_API_KEY: "secret" });

    expect(() => guard.canActivate(contextWithHeader())).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWithHeader("wrong"))).toThrow(
      UnauthorizedException,
    );
  });

  it("fails closed when ADMIN_API_KEY is not configured", () => {
    const guard = new AdminApiKeyGuard({});

    expect(() => guard.canActivate(contextWithHeader("secret"))).toThrow(
      UnauthorizedException,
    );
  });
});
