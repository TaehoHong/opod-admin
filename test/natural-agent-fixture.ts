import { NATURAL_AGENT_STARTERS } from "../prompts/natural-post-agent";
import {
  naturalSchemas,
  NaturalAgentBundle,
} from "../src/post-production/natural-post-agent";
import { canonicalJsonHash } from "../src/post-production/post-pipeline-v3";
export function naturalAgentBundle(): NaturalAgentBundle {
  const content = {
    version: 1 as const,
    schedulerDefault: false,
    planningModel: {
      aiModelId: "1",
      provider: "openai-compatible",
      model: "natural-planner",
    },
    reviewModel: {
      aiModelId: "2",
      provider: "openai-compatible",
      model: "independent-vision",
    },
    generation: {
      id: "17",
      revision: 1,
      aiModelId: "3",
      provider: "openai",
      effectiveModel: "gpt-image-2.5-sunburst",
    },
    prompts: { ...NATURAL_AGENT_STARTERS },
    schemas: naturalSchemas(),
  };
  return { ...content, revision: canonicalJsonHash(content) };
}
