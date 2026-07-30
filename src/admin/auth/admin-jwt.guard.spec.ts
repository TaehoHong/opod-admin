import { UnauthorizedException } from "@nestjs/common";
import { AdminJwtGuard } from "./admin-jwt.guard";
import { ADMIN_SESSION_COOKIE } from "./admin-session";

function contextWithCookie(value?: string) {
  const request: {
    admin?: unknown;
    adminToken?: string;
    header(name: string): string | undefined;
  } = {
    header: (name: string) =>
      name.toLowerCase() === "cookie" ? value : undefined,
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
  it("authenticates the session cookie and stores the admin on the request", async () => {
    const guard = new AdminJwtGuard({
      authenticateAdminToken: jest.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@example.test",
      }),
    } as never);
    const { context, request } = contextWithCookie(
      `other=x; ${ADMIN_SESSION_COOKIE}=token-1; another=y`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.admin).toEqual({
      id: "admin-1",
      email: "admin@example.test",
    });
    expect(request.adminToken).toBe("token-1");
  });

  // Bearer 헤더를 계속 받아주면 XSS로 읽을 수 있는 저장소 기반 인증이
  // 그대로 살아남는다.
  it("rejects an Authorization header without the session cookie", async () => {
    const authenticateAdminToken = jest.fn();
    const guard = new AdminJwtGuard({ authenticateAdminToken } as never);
    const request = {
      header: (name: string) =>
        name.toLowerCase() === "authorization" ? "Bearer token-1" : undefined,
    };

    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(authenticateAdminToken).not.toHaveBeenCalled();
  });

  it("rejects a missing session cookie", async () => {
    const guard = new AdminJwtGuard({
      authenticateAdminToken: jest.fn(),
    } as never);
    const { context } = contextWithCookie();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
