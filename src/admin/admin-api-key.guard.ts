import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

type AdminEnv = {
  ADMIN_API_KEY?: string;
};

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject("ADMIN_ENV")
    private readonly env: AdminEnv = process.env,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.env.ADMIN_API_KEY?.trim();
    const request = context.switchToHttp().getRequest<{
      header(name: string): string | undefined;
    }>();
    const actual = request.header("x-admin-api-key")?.trim();

    if (!expected || !actual || !this.matches(expected, actual)) {
      throw new UnauthorizedException("Admin API key is required");
    }

    return true;
  }

  private matches(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }
}
