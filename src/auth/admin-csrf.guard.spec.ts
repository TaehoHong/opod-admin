import { ForbiddenException } from "@nestjs/common";
import { AdminCsrfGuard } from "./admin-csrf.guard";
import { ADMIN_REQUEST_HEADER } from "./admin-session";

function contextWith(headers: Record<string, string>, protocol = "https") {
  const request = {
    method: "POST",
    protocol,
    header: (name: string) => headers[name.toLowerCase()],
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("AdminCsrfGuard", () => {
  const guard = new AdminCsrfGuard();

  // 앞단 nginx가 TLS를 끊고 평문으로 넘기는 구성. Host는 원본 도메인이,
  // 스킴은 x-forwarded-proto가 알려준다.
  it("accepts a forwarded https request that keeps the original host", () => {
    const context = contextWith({
      [ADMIN_REQUEST_HEADER.toLowerCase()]: "1",
      origin: "https://admin.example.test",
      host: "admin.example.test",
      "x-forwarded-proto": "https, http",
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  // x-forwarded-proto가 없으면 요청 자체의 protocol을 쓴다.
  it("uses the request protocol when the proxy forwards no scheme", () => {
    const context = contextWith({
      [ADMIN_REQUEST_HEADER.toLowerCase()]: "1",
      origin: "https://admin.example.test",
      host: "admin.example.test",
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("accepts a direct http request from the same localhost origin", () => {
    const context = contextWith(
      {
        [ADMIN_REQUEST_HEADER.toLowerCase()]: "1",
        origin: "http://localhost:3200",
        host: "localhost:3200",
      },
      "http",
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  // proxy_set_header Host를 빠뜨리면 nginx는 Host를 upstream 주소로 덮어쓴다.
  // 그러면 브라우저 Origin과 기대값이 어긋나 로그인이 통째로 막힌다.
  it("rejects the request when the proxy overwrites host with the upstream", () => {
    const context = contextWith({
      [ADMIN_REQUEST_HEADER.toLowerCase()]: "1",
      origin: "https://admin.example.test",
      host: "127.0.0.1:7100",
      "x-forwarded-proto": "https",
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("rejects an origin from another host", () => {
    const context = contextWith({
      [ADMIN_REQUEST_HEADER.toLowerCase()]: "1",
      origin: "https://evil.example.test",
      host: "admin.example.test",
      "x-forwarded-proto": "https",
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
