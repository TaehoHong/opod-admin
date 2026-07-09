import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { AdminJwtGuard, AdminRequest } from "./admin-jwt.guard";

@Controller("api/admin")
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post("login")
  login(@Body() body: Parameters<AdminAuthService["login"]>[0]) {
    return this.adminAuthService.login(body);
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
    @Body()
    body: Parameters<AdminAuthService["createAdminAccount"]>[0],
  ) {
    return this.adminAuthService.createAdminAccount(
      body,
      request.admin?.id ?? "",
    );
  }

  @Post("logout")
  @UseGuards(AdminJwtGuard)
  logout() {
    return this.adminAuthService.logout();
  }
}
