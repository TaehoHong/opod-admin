import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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

  async get(idValue: string) {
    if (
      !/^[1-9]\d{0,18}$/.test(idValue) ||
      BigInt(idValue) > 9223372036854775807n
    ) {
      throw new BadRequestException("액션 로그 ID가 올바르지 않습니다.");
    }
    const log = await this.logs.findById(BigInt(idValue));
    if (!log) throw new NotFoundException("액션 로그를 찾을 수 없습니다.");
    return {
      ...log,
      id: log.id.toString(),
      createdAt: log.createdAt.toISOString(),
      targetTable: log.targetTable ?? undefined,
      targetId: log.targetId ?? undefined,
    };
  }
}
