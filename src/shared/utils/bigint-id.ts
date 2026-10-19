import { BadRequestException } from "@nestjs/common";

export function parseBigintId(value: string, message: string): bigint {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/.test(value) ||
    value.length > 19 ||
    BigInt(value) > 9223372036854775807n
  ) {
    throw new BadRequestException(message);
  }
  return BigInt(value);
}
