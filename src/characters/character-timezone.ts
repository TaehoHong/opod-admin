import { BadRequestException } from "@nestjs/common";

export function normalizeCharacterTimezone(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  const timezone = value.trim();
  if (!timezone) {
    throw new BadRequestException(
      "character timezone must be a valid IANA timezone",
    );
  }
  try {
    const canonical = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
    }).resolvedOptions().timeZone;
    if (/^[+-]/.test(canonical)) throw new Error("fixed offset is not IANA");
    return canonical;
  } catch {
    throw new BadRequestException(
      "character timezone must be a valid IANA timezone",
    );
  }
}
