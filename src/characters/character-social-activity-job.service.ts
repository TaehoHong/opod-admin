import { Injectable } from "@nestjs/common";
import { CharacterSocialActivityJobRepository } from "./character-social-activity-job.repository";

@Injectable()
export class CharacterSocialActivityJobService {
  constructor(private readonly jobs: CharacterSocialActivityJobRepository) {}

  findLatest(characterId: string) {
    return this.jobs.findLatest(characterId);
  }

  cancelActive(characterId: string) {
    return this.jobs.cancelActive(characterId);
  }
}
