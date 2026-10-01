import { isRecord } from "../shared/utils/value-utils";

export type InputQuote = { path: string; quote: string };

// Paths use input field names and decimal array indexes, e.g. memories.0.content.
export function inputValue(input: unknown, path: string): unknown {
  if (!/^[A-Za-z][A-Za-z0-9]*(\.(?:[A-Za-z][A-Za-z0-9]*|\d+))*$/.test(path))
    return undefined;
  let value = input;
  for (const segment of path.split(".")) {
    if (
      (!isRecord(value) && !Array.isArray(value)) ||
      !Object.prototype.hasOwnProperty.call(value, segment)
    )
      return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export function matchesInputQuote(value: unknown, quote: string): boolean {
  if (typeof value === "string") return value.includes(quote);
  if (typeof value === "number") return String(value) === quote;
  // Conflict sources are arrays of authored context entries. Metadata is not evidence.
  if (Array.isArray(value))
    return value.some(
      (entry) => isRecord(entry) && matchesInputQuote(entry.content, quote),
    );
  return false;
}
