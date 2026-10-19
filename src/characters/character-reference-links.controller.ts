import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { CharacterReferenceLinkService } from "./character-reference-link.service";
import { SaveCharacterReferenceLinkDto } from "./dto/save-character-reference-link.dto";

@Controller("api/admin/v1/characters/:characterId/reference-links")
@UseGuards(AdminJwtGuard)
export class CharacterReferenceLinksController {
  constructor(private readonly links: CharacterReferenceLinkService) {}

  @Get()
  list(@Param("characterId", new ParseUUIDPipe()) characterId: string) {
    return this.links.list(characterId);
  }

  @Post()
  create(
    @Param("characterId", new ParseUUIDPipe()) characterId: string,
    @Body() body: SaveCharacterReferenceLinkDto,
  ) {
    return this.links.create(characterId, body.url);
  }

  @Patch(":linkId")
  update(
    @Param("characterId", new ParseUUIDPipe()) characterId: string,
    @Param("linkId") linkId: string,
    @Body() body: SaveCharacterReferenceLinkDto,
  ) {
    return this.links.update(characterId, linkId, body.url);
  }

  @Delete(":linkId")
  delete(
    @Param("characterId", new ParseUUIDPipe()) characterId: string,
    @Param("linkId") linkId: string,
  ) {
    return this.links.delete(characterId, linkId);
  }
}
