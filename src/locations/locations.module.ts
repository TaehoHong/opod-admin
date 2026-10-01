import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { LocationsRepository } from "./locations.repository";
import { LocationsService } from "./locations.service";

@Module({
  imports: [DatabaseModule],
  providers: [LocationsRepository, LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
