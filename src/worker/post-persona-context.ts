export type PostPersonaEntry = {
  title: string;
  content: string;
  sourceId?: string;
  fragmentId?: string;
  schemaVersion?: number;
  kind?: string;
  injection?: string;
  recallKeys?: string[];
  canonIds?: string[];
};

export type StoredPostPersona = PostPersonaEntry & {
  id?: string;
  fragments?: {
    id: string;
    content: string;
    kind: string;
    injection: string;
    recallKeys: string[];
    canonIds: string[];
  }[];
};

export type PostMemoryEntry = {
  type: string;
  content: string;
  sourceId?: string;
  kind?: string | null;
  injection?: string | null;
  recallKeys?: string[];
  occurredAt?: string | null;
  occurredLabel?: string | null;
  occurredPrecision?: string | null;
  personaSources?: { sourceId: string; fragmentId: string }[];
};

// Publication is never a conversation start. Project before alias resolution,
// logging or prompt assembly so excluded text cannot return via its parent body.
export function projectPostPersonaContext(input: {
  personas: StoredPostPersona[];
  memories: PostMemoryEntry[];
  query: string;
  bio: string;
  interests: string[];
}):
  | { status: "invalid" }
  | {
      status: "ready";
      hasV2: boolean;
      personas: PostPersonaEntry[];
      memories: PostMemoryEntry[];
    } {
  const entries: PostPersonaEntry[] = [];
  for (const source of input.personas) {
    const version = source.schemaVersion ?? 1;
    const fragments = source.fragments ?? [];
    if (
      ![1, 2].includes(version) ||
      (version === 2 && fragments.length === 0) ||
      (fragments.length > 0 &&
        fragments.map((fragment) => fragment.content).join("") !==
          source.content)
    ) {
      return { status: "invalid" };
    }
    if (fragments.length === 0) {
      entries.push({
        title: source.title,
        content: source.content,
        ...(source.id ? { sourceId: source.id, schemaVersion: version } : {}),
      });
      continue;
    }
    for (const fragment of fragments) {
      if (
        fragment.kind === "creator_note" ||
        fragment.kind === "greeting" ||
        !["always", "retrieved"].includes(fragment.injection)
      )
        continue;
      entries.push({
        title: version === 2 ? fragment.kind : source.title,
        content: fragment.content,
        sourceId: source.id,
        fragmentId: fragment.id,
        schemaVersion: version,
        kind: fragment.kind,
        injection: fragment.injection,
        recallKeys: fragment.recallKeys,
        canonIds: fragment.canonIds,
      });
    }
  }
  // Before a candidate exists, only authored stable context seeds recall.
  // Retrieved text, examples and recent generated posts cannot retrieve themselves.
  const query = normalize(
    input.query.trim() ||
      [
        input.bio,
        ...input.interests,
        ...entries
          .filter(
            (entry) =>
              entry.injection !== "retrieved" &&
              entry.kind !== "example" &&
              [
                "identity",
                "personality",
                "background",
                "lifestyle",
                "motivation",
                "judgment",
                "tension",
                "relationship",
              ].includes(postPersonaRole(entry)),
          )
          .map((entry) => entry.content),
      ].join("\n"),
  );
  const relevant = (keys: string[] = []) =>
    keys.some((key) => normalize(key) && query.includes(normalize(key)));
  let legacyCount = 0;
  let recalledCount = 0;
  return {
    status: "ready",
    hasV2: input.personas.some((source) => source.schemaVersion === 2),
    personas: entries.filter(
      (entry) => entry.injection !== "retrieved" || relevant(entry.recallKeys),
    ),
    memories: input.memories.filter((memory) => {
      if (!memory.injection) return legacyCount++ < 20;
      if (memory.injection === "always") return true;
      // Canon links are provenance, not a command to retrieve a memory.
      return (
        memory.injection === "retrieved" &&
        relevant(memory.recallKeys) &&
        recalledCount++ < 20
      );
    }),
  };
}

export function postPersonaRole(entry: PostPersonaEntry): string {
  const role = entry.schemaVersion === 2 ? entry.kind : entry.title;
  const normalized = (role ?? "").trim().toLowerCase().replace(/[ -]+/g, "_");
  return normalized === "boundary" ? "boundaries" : normalized;
}

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}
