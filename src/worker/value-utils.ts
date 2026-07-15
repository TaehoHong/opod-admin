export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parsePositiveNumber(
  value: string | undefined,
): number | undefined {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
