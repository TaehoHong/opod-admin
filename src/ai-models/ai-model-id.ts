import { parseBigintId } from "../shared/utils/bigint-id";
// These entities use PostgreSQL BIGINT IDs; never parse them through Number.
export function aiConfigId(value: string): bigint {
  return parseBigintId(value, "Invalid model or prompt id");
}
