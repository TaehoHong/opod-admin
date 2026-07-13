import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { AdminJwtGuard, AdminRequest } from "./admin-jwt.guard";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { CreateAdminAccountDto } from "./dto/create-admin-account.dto";

@Controller("api/admin")
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post("login")
  login(@Body() body: AdminLoginDto) {
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
    @Body() body: CreateAdminAccountDto,
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
