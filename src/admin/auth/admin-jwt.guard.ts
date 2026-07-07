import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  AdminAuthService,
  AuthenticatedAdmin,
} from "./admin-auth.service";

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
    const token = bearerToken(request.header("authorization"));
    if (!token) {
      throw new UnauthorizedException("Admin login is required");
    }

    request.admin = await this.adminAuthService.authenticateAdminToken(token);
    request.adminToken = token;
    return true;
  }
}

function bearerToken(value?: string) {
  const [scheme, token] = String(value ?? "").trim().split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" ? token : "";
}
