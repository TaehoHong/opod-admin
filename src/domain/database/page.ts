import { BadRequestException } from "@nestjs/common";

export type PageInput = {
  cursor?: string;
  limit: number;
};

export type Page<T> = {
  items: T[];
  nextCursor?: string;
};

export function parsePageQuery(
  cursor?: string,
  limitValue?: string,
): PageInput {
  const limit = limitValue === undefined ? 20 : Number(limitValue);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new BadRequestException("limit must be a positive integer");
  }

  return {
    limit: Math.min(limit, 50),
    ...(cursor?.trim() ? { cursor: cursor.trim() } : {}),
  };
}

export function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { id?: unknown };
    if (typeof parsed.id !== "string" || !parsed.id.trim()) {
      throw new Error("missing id");
    }
    return parsed.id;
  } catch {
    throw new BadRequestException("Invalid cursor");
  }
}

export function pageFromRows<T extends { id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  return {
    items,
    ...(rows.length > limit && items.length > 0
      ? { nextCursor: encodeCursor(items[items.length - 1].id) }
      : {}),
  };
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}
