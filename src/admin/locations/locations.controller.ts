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
import { parsePageQuery } from "../../domain/database/page";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { CreateLocationDto } from "./dto/create-location.dto";
import { SetLocationReferencesDto } from "./dto/set-location-references.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { LocationsService } from "./locations.service";

@Controller("api/admin/v1/locations")
@UseGuards(AdminJwtGuard)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("scope") scope?: string,
    @Query("characterId") characterId?: string,
  ) {
    return this.locations.list({
      ...parsePageQuery(cursor, limit),
      scope,
      characterId,
    });
  }

  @Post()
  create(@Body() body: CreateLocationDto) {
    return this.locations.create(body);
  }

  @Get(":id")
  get(@Param("id") locationId: string) {
    return this.locations.get(locationId);
  }

  @Patch(":id")
  update(@Param("id") locationId: string, @Body() body: UpdateLocationDto) {
    return this.locations.update(locationId, body);
  }

  @Delete(":id")
  delete(@Param("id") locationId: string) {
    return this.locations.delete(locationId);
  }

  @Put(":id/references")
  setReferences(
    @Param("id") locationId: string,
    @Body() body: SetLocationReferencesDto,
  ) {
    return this.locations.setReferences(locationId, body.references);
  }
}
