import { BadRequestException } from "@nestjs/common";
// These entities use PostgreSQL BIGINT IDs; never parse them through Number.
export function aiConfigId(value: string): bigint {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/.test(value) ||
    value.length > 19 ||
    BigInt(value) > 9223372036854775807n
  ) {
    throw new BadRequestException("Invalid model or prompt id");
  }
  return BigInt(value);
}
