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
import { CreateCharacterMemoriesDto } from "./dto/create-character-memories.dto";
import { CreateCharacterMemoryDto } from "./dto/create-character-memory.dto";
import { CreateCharacterPersonaDto } from "./dto/create-character-persona.dto";
import { CreateCharacterPersonasDto } from "./dto/create-character-personas.dto";
import { CreateCharacterDto } from "./dto/create-character.dto";
import { DeleteCharacterDto } from "./dto/delete-character.dto";
import { EnqueueVisualProfileTestGenerationDto } from "./dto/enqueue-visual-profile-test-generation.dto";
import { ReorderCharacterPersonasDto } from "./dto/reorder-character-personas.dto";
import { SetVisualProfileReferencesDto } from "./dto/set-visual-profile-references.dto";
import { UpdateCharacterMemoryDto } from "./dto/update-character-memory.dto";
import { UpdateCharacterPersonaDto } from "./dto/update-character-persona.dto";
import { UpdateCharacterStatusDto } from "./dto/update-character-status.dto";
import { UpdateCharacterDto } from "./dto/update-character.dto";
import { UpsertPostingPolicyDto } from "./dto/upsert-posting-policy.dto";
import { UpsertVisualProfileDto } from "./dto/upsert-visual-profile.dto";
import { PostingPolicyService } from "./posting-policy.service";
import { VisualProfileService } from "./visual-profile.service";

@Controller("api/characters")
@UseGuards(AdminJwtGuard)
export class CharactersController {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly postingPolicyService: PostingPolicyService,
    private readonly visualProfileService: VisualProfileService,
  ) {}

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
  createCharacter(@Body() body: CreateCharacterDto) {
    return this.charactersService.createCharacter(body);
  }

  @Patch(":id/status")
  updateCharacterStatus(
    @Param("id") characterId: string,
    @Body() body: UpdateCharacterStatusDto,
  ) {
    return this.charactersService.updateCharacterStatus({
      id: characterId,
      ...body,
    });
  }

  @Patch(":id")
  updateCharacter(
    @Param("id") characterId: string,
    @Body() body: UpdateCharacterDto,
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
    @Body() body: DeleteCharacterDto,
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
    @Body() body: CreateCharacterPersonaDto,
  ) {
    return this.charactersService.createCharacterPersona({
      characterId,
      ...body,
    });
  }

  @Post(":id/personas/bulk")
  createCharacterPersonas(
    @Param("id") characterId: string,
    @Body() body: CreateCharacterPersonasDto,
  ) {
    return this.charactersService.createCharacterPersonas({
      characterId,
      ...body,
    });
  }

  @Put(":id/personas/order")
  reorderCharacterPersonas(
    @Param("id") characterId: string,
    @Body() body: ReorderCharacterPersonasDto,
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
    @Body() body: UpdateCharacterPersonaDto,
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
    @Body() body: CreateCharacterMemoryDto,
  ) {
    return this.charactersService.createCharacterMemory({
      characterId,
      ...body,
    });
  }

  @Post(":id/memory/bulk")
  createCharacterMemories(
    @Param("id") characterId: string,
    @Body() body: CreateCharacterMemoriesDto,
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
    @Body() body: UpdateCharacterMemoryDto,
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

  @Get(":id/visual-profile")
  getVisualProfile(@Param("id") characterId: string) {
    return this.visualProfileService.getProfile(characterId);
  }

  @Put(":id/visual-profile")
  upsertVisualProfile(
    @Param("id") characterId: string,
    @Body() body: UpsertVisualProfileDto,
  ) {
    return this.visualProfileService.upsertProfile({ characterId, ...body });
  }

  @Put(":id/visual-profile/references")
  setVisualProfileReferences(
    @Param("id") characterId: string,
    @Body() body: SetVisualProfileReferencesDto,
  ) {
    return this.visualProfileService.setReferences({ characterId, ...body });
  }

  @Post(":id/visual-profile/test-generation")
  enqueueVisualProfileTestGeneration(
    @Param("id") characterId: string,
    @Body() body: EnqueueVisualProfileTestGenerationDto,
  ) {
    return this.visualProfileService.enqueueTestGeneration({
      characterId,
      ...body,
    });
  }

  @Get(":id/posting-policy")
  getPostingPolicy(@Param("id") characterId: string) {
    return this.postingPolicyService.getPolicy(characterId);
  }

  @Put(":id/posting-policy")
  upsertPostingPolicy(
    @Param("id") characterId: string,
    @Body() body: UpsertPostingPolicyDto,
  ) {
    return this.postingPolicyService.upsertPolicy({ characterId, ...body });
  }
}
