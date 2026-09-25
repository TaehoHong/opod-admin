import { Injectable } from "@nestjs/common";
import { CharacterActionLogRepository } from "./character-action-log.repository";

@Injectable()
export class CharacterActionLogService {
  constructor(private readonly logs: CharacterActionLogRepository) {}

  record(input: Parameters<CharacterActionLogRepository["record"]>[0]) {
    return this.logs.record(input);
  }

  list(input: Parameters<CharacterActionLogRepository["list"]>[0]) {
    return this.logs.list(input);
  }
}
