import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AdminAuthService, AuthenticatedAdmin } from "./admin-auth.service";
import { readSessionCookie } from "./admin-session";

export type AdminRequest = {
  admin?: AuthenticatedAdmin;
  adminToken?: string;
  header(name: string): string | undefined;
};

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    // 세션은 HttpOnly cookie에만 있다 — JavaScript가 읽을 수 있는 저장소에
    // 토큰을 두지 않는다 (docs/06-architecture.md:120).
    const token = readSessionCookie(request.header("cookie"));
    if (!token) {
      throw new UnauthorizedException("Admin login is required");
    }

    request.admin = await this.adminAuthService.authenticateAdminToken(token);
    request.adminToken = token;
    return true;
  }
}
