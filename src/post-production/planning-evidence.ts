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

export type ContextFactEntry = { content: string; contextFactId?: string };
type ContextFactInput = {
  persona: {
    characterContext: ContextFactEntry[];
    boundaries: ContextFactEntry[];
    additionalContext: ContextFactEntry[];
  };
  memories: ContextFactEntry[];
};

// Only authored persona content and memories are eligible; metadata, writing
// examples, content profiles and recent posts are not selection sources.
function contextFactEntries(input: ContextFactInput) {
  return [
    ...(
      ["characterContext", "boundaries", "additionalContext"] as const
    ).flatMap((group) =>
      input.persona[group].map((entry, index) => ({
        entry,
        path: `persona.${group}.${index}.content`,
      })),
    ),
    ...input.memories.map((entry, index) => ({
      entry,
      path: `memories.${index}.content`,
    })),
  ].filter(({ entry }) => entry.content.trim());
}

// IDs belong to this planning input, not to a DB row or a later retrieval.
export function assignContextFactIds(input: ContextFactInput): void {
  contextFactEntries(input).forEach(({ entry }, index) => {
    entry.contextFactId = `F${index + 1}`;
  });
}

export function resolveContextFactIds(
  input: ContextFactInput,
  ids: unknown,
): {
  contextFactIds: string[];
  contextFacts: InputQuote[];
} {
  if (
    !Array.isArray(ids) ||
    ids.length > 8 ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  )
    throw new Error("invalid context fact IDs");
  const available = new Map(
    contextFactEntries(input)
      .filter(({ entry }) => entry.contextFactId)
      .map(({ entry, path }) => [
        entry.contextFactId,
        { path, quote: entry.content },
      ]),
  );
  return {
    contextFactIds: ids as string[],
    contextFacts: ids.map((id) => {
      const fact = available.get(id);
      if (!fact) throw new Error("unknown context fact ID");
      return fact;
    }),
  };
}
