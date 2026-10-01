import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { PostPlanningAgent } from "./post-planner";
import { ImagePlanningAgent } from "./image-planner";
import { ImagePromptGenerationAgent } from "./image-prompt-generator";
import { CaptionWriterAgent } from "./caption-writer";

describe("DB prompt required", () => {
  it.each(["post_plan", "image_plan", "image_prompt", "caption"])(
    "does not call the model or read media without %s settings",
    async (stage) => {
      const fetchMock = jest.fn();
      const readMedia = jest.fn();
      const client = new StrictJsonAgentClient(
        { apiUrl: "https://llm.test", apiKey: "key", model: "model" },
        fetchMock,
      );
      const call = () => {
        switch (stage) {
          case "post_plan":
            return new PostPlanningAgent(client).plan({} as never);
          case "image_plan":
            return new ImagePlanningAgent(client).plan({} as never);
          case "image_prompt":
            return new ImagePromptGenerationAgent(client).generate({} as never);
          default:
            return new CaptionWriterAgent(client, readMedia).write(
              {} as never,
              [],
            );
        }
      };
      await expect(call()).rejects.toThrow("Saved agent prompt is required");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readMedia).not.toHaveBeenCalled();
    },
  );
});
