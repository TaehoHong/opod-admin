import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { CharacterContentProfileRepository } from "./character-content-profile.repository";
import { CharacterContentProfileService } from "./character-content-profile.service";

@Module({
  imports: [DatabaseModule],
  providers: [
    CharacterContentProfileRepository,
    CharacterContentProfileService,
  ],
  exports: [CharacterContentProfileService],
})
export class CharacterContentProfilesModule {}
