import { UnauthorizedException } from "@nestjs/common";
import { AdminJwtGuard } from "./admin-jwt.guard";

function contextWithAuthorization(value?: string) {
  const request: {
    admin?: unknown;
    adminToken?: string;
    header(name: string): string | undefined;
  } = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? value : undefined,
  };

  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never,
  };
}

describe("AdminJwtGuard", () => {
  it("authenticates bearer tokens and stores the admin on the request", async () => {
    const guard = new AdminJwtGuard({
      authenticateAdminToken: jest.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@opod.com",
      }),
    } as never);
    const { context, request } = contextWithAuthorization("Bearer token-1");

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.admin).toEqual({
      id: "admin-1",
      email: "admin@opod.com",
    });
    expect(request.adminToken).toBe("token-1");
  });

  it("rejects missing bearer tokens", async () => {
    const guard = new AdminJwtGuard({
      authenticateAdminToken: jest.fn(),
    } as never);
    const { context } = contextWithAuthorization();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
