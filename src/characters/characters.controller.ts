import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminJwtGuard } from "../admin/auth/admin-jwt.guard";
import { parsePageQuery } from "../domain/database/page";
import { CharactersService } from "./characters.service";

@Controller("api/characters")
@UseGuards(AdminJwtGuard)
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get()
  listCharacters(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
  ) {
    return this.charactersService.listCharacters({
      status,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Post()
  createCharacter(
    @Body()
    body: Parameters<CharactersService["createCharacter"]>[0],
  ) {
    return this.charactersService.createCharacter(body);
  }

  @Patch(":id/status")
  updateCharacterStatus(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["updateCharacterStatus"]>[0],
      "id"
    >,
  ) {
    return this.charactersService.updateCharacterStatus({
      id: characterId,
      ...body,
    });
  }

  @Patch(":id")
  updateCharacter(
    @Param("id") characterId: string,
    @Body()
    body: Omit<Parameters<CharactersService["updateCharacter"]>[0], "id">,
  ) {
    return this.charactersService.updateCharacter({ id: characterId, ...body });
  }

  @Get(":id")
  getCharacter(@Param("id") characterId: string) {
    return this.charactersService.getCharacter(characterId);
  }

  @Delete(":id")
  deleteCharacter(
    @Param("id") characterId: string,
    @Body()
    body: Omit<Parameters<CharactersService["deleteCharacter"]>[0], "id">,
  ) {
    return this.charactersService.deleteCharacter({ id: characterId, ...body });
  }

  @Get(":id/personas")
  listCharacterPersonas(@Param("id") characterId: string) {
    return this.charactersService.listCharacterPersonas(characterId);
  }

  @Post(":id/personas")
  createCharacterPersona(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["createCharacterPersona"]>[0],
      "characterId"
    >,
  ) {
    return this.charactersService.createCharacterPersona({
      characterId,
      ...body,
    });
  }

  @Post(":id/personas/bulk")
  createCharacterPersonas(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["createCharacterPersonas"]>[0],
      "characterId"
    >,
  ) {
    return this.charactersService.createCharacterPersonas({
      characterId,
      ...body,
    });
  }

  @Put(":id/personas/order")
  reorderCharacterPersonas(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["reorderCharacterPersonas"]>[0],
      "characterId"
    >,
  ) {
    return this.charactersService.reorderCharacterPersonas({
      characterId,
      ...body,
    });
  }

  @Patch(":id/personas/:personaId")
  updateCharacterPersona(
    @Param("id") characterId: string,
    @Param("personaId") personaId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["updateCharacterPersona"]>[0],
      "characterId" | "personaId"
    >,
  ) {
    return this.charactersService.updateCharacterPersona({
      characterId,
      personaId,
      ...body,
    });
  }

  @Delete(":id/personas/:personaId")
  deleteCharacterPersona(
    @Param("id") characterId: string,
    @Param("personaId") personaId: string,
  ) {
    return this.charactersService.deleteCharacterPersona({
      characterId,
      personaId,
    });
  }

  @Get(":id/memory")
  listCharacterMemory(@Param("id") characterId: string) {
    return this.charactersService.listCharacterMemory(characterId);
  }

  @Post(":id/memory")
  createCharacterMemory(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["createCharacterMemory"]>[0],
      "characterId"
    >,
  ) {
    return this.charactersService.createCharacterMemory({
      characterId,
      ...body,
    });
  }

  @Post(":id/memory/bulk")
  createCharacterMemories(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["createCharacterMemories"]>[0],
      "characterId"
    >,
  ) {
    return this.charactersService.createCharacterMemories({
      characterId,
      ...body,
    });
  }

  @Patch(":id/memory/:memoryId")
  updateCharacterMemory(
    @Param("id") characterId: string,
    @Param("memoryId") memoryId: string,
    @Body()
    body: Omit<
      Parameters<CharactersService["updateCharacterMemory"]>[0],
      "characterId" | "memoryId"
    >,
  ) {
    return this.charactersService.updateCharacterMemory({
      characterId,
      memoryId,
      ...body,
    });
  }

  @Delete(":id/memory/:memoryId")
  deleteCharacterMemory(
    @Param("id") characterId: string,
    @Param("memoryId") memoryId: string,
  ) {
    return this.charactersService.deleteCharacterMemory({
      characterId,
      memoryId,
    });
  }
}
