export const REFERENCE_SELECTION_SYSTEM_PROMPT =
  "characters\n    │\ncharacter_influencers\n    │\ninfluencers\n    │\ninfluencer_media\n";

export const REFERENCE_SELECTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["selected", "no_match"] },
    selections: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          mediaId: { type: "string" },
          reason: { type: "string", minLength: 1 },
        },
        required: ["mediaId", "reason"],
        additionalProperties: false,
      },
    },
    shortfallReason: { type: "string" },
  },
  required: ["status", "selections", "shortfallReason"],
  additionalProperties: false,
};
