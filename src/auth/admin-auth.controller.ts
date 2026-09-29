import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { AdminJwtGuard, AdminRequest } from "./admin-jwt.guard";
import { clearSessionCookie, serializeSessionCookie } from "./admin-session";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { CreateAdminAccountDto } from "./dto/create-admin-account.dto";

// express 타입 패키지를 새로 들이지 않기 위한 구조적 타입 (src/main.ts와 동일).
type CookieResponse = { setHeader(name: string, value: string): void };

@Controller("api/admin/v1/auth")
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post("login")
  async login(
    @Body() body: AdminLoginDto,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.adminAuthService.login(body);
    // 토큰은 응답 본문이 아니라 HttpOnly cookie로만 전달한다.
    response.setHeader("Set-Cookie", serializeSessionCookie(result.token));
    return { admin: result.admin, expiresAt: result.expiresAt };
  }

  @Get("me")
  @UseGuards(AdminJwtGuard)
  me(@Req() request: AdminRequest) {
    return { admin: request.admin };
  }

  @Post("accounts")
  @UseGuards(AdminJwtGuard)
  createAdminAccount(
    @Req() request: AdminRequest,
    @Body() body: CreateAdminAccountDto,
  ) {
    return this.adminAuthService.createAdminAccount(
      body,
      request.admin?.id ?? "",
    );
  }

  @Post("logout")
  @UseGuards(AdminJwtGuard)
  async logout(@Res({ passthrough: true }) response: CookieResponse) {
    // 서버 측 무효화 목록 없이 cookie 제거로 끝낸다
    // (docs/06-architecture.md:121-122).
    response.setHeader("Set-Cookie", clearSessionCookie());
    return this.adminAuthService.logout();
  }
}
