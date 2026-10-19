import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { parsePageQuery } from "../shared/utils/page";
import { CharacterReferenceDirectoryApplicationService } from "./character-reference-directory-application.service";

@Controller("api/admin/v1/character-reference-directory")
@UseGuards(AdminJwtGuard)
export class CharacterReferenceDirectoryController {
  constructor(
    private readonly directory: CharacterReferenceDirectoryApplicationService,
  ) {}

  @Get()
  list(
    @Query("search") search?: string,
    @Query("registration") registration?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.directory.list({
      search,
      registration,
      ...parsePageQuery(cursor, limit),
    });
  }
}
