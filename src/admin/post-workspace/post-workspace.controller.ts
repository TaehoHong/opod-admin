import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { parsePageQuery } from "../../domain/database/page";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { PostWorkspaceService } from "./post-workspace.service";

@Controller("api/admin/v1/post-work-items")
@UseGuards(AdminJwtGuard)
export class PostWorkspaceController {
  constructor(private readonly workspace: PostWorkspaceService) {}

  @Get()
  list(
    @Query("filter") filter?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const page = parsePageQuery(undefined, limit);
    return this.workspace.list({ filter, cursor, limit: page.limit });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.workspace.get(id);
  }
}
