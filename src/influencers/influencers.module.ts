import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { AdminAuthModule } from "../auth/admin-auth.module";
import { SettingsModule } from "../settings/settings.module";
import { InfluencerRepository } from "./influencer.repository";
import { InfluencerService } from "./influencer.service";
import { CharacterInfluencerRepository } from "./character-influencer.repository";
import { CharacterInfluencerService } from "./character-influencer.service";
import { InfluencerMediaRepository } from "./influencer-media.repository";
import { InfluencerMediaService } from "./influencer-media.service";
import { InfluencerMediaStore } from "./influencer-media-store";
import { InfluencerMediaApplicationService } from "./influencer-media-application.service";
import { InfluencersController } from "./influencers.controller";
@Module({
  imports: [DatabaseModule, AdminAuthModule, SettingsModule],
  controllers: [InfluencersController],
  providers: [
    InfluencerRepository,
    InfluencerService,
    CharacterInfluencerRepository,
    CharacterInfluencerService,
    InfluencerMediaRepository,
    InfluencerMediaService,
    InfluencerMediaStore,
    InfluencerMediaApplicationService,
  ],
  exports: [InfluencerService, CharacterInfluencerService],
})
export class InfluencersModule {}
