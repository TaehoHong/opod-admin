import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ADMIN_REQUEST_HEADER } from "./admin-session";

// GET/HEAD/OPTIONS는 상태를 바꾸지 않는다 (docs/06-architecture.md:127).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfRequest = {
  method: string;
  header(name: string): string | undefined;
};

// SameSite=Strict cookie 위에 얹는 두 번째 방어선. 별도 CSRF library나
// signed double-submit token은 쓰지 않는다 (docs/06-architecture.md:124,128).
//
// - 고정 custom header: 브라우저가 cross-origin으로 임의 헤더를 붙이려면
//   preflight가 필요한데 CORS를 열지 않아 통과하지 못한다.
// - Origin: 존재하면 요청 대상 origin과 정확히 일치해야 한다. 브라우저가
//   아닌 클라이언트(배포 스크립트, supertest)는 Origin을 보내지 않으므로
//   부재 자체는 거부하지 않는다 — 그 경로는 위의 헤더 요구로 막힌다.
@Injectable()
export class AdminCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CsrfRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    if (!request.header(ADMIN_REQUEST_HEADER)) {
      throw new ForbiddenException(
        `${ADMIN_REQUEST_HEADER} header is required for state-changing requests`,
      );
    }

    const origin = request.header("origin");
    if (origin && origin !== expectedOrigin(request)) {
      throw new ForbiddenException("Origin is not allowed");
    }
    return true;
  }
}

function expectedOrigin(request: CsrfRequest): string {
  const host = request.header("host") ?? "";
  // TLS 종단이 앞단 프록시일 수 있으므로 전달된 스킴을 우선한다.
  const proto = request.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${proto || "https"}://${host}`;
}
