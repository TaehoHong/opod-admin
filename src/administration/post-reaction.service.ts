import { Injectable } from "@nestjs/common";
import { CharacterService } from "../characters/character.service";
import { CharacterActionLogService } from "../characters/character-action-log.service";
import { PostReactionRepository } from "./post-reaction.repository";

@Injectable()
export class PostReactionService {
  constructor(
    private readonly reactions: PostReactionRepository,
    private readonly characters: CharacterService,
    private readonly actionLogs: CharacterActionLogService,
  ) {}

  hasCursor(...args: Parameters<PostReactionRepository["hasCursor"]>) {
    return this.reactions.hasCursor(...args);
  }

  list(input: Parameters<PostReactionRepository["list"]>[0]) {
    return this.reactions.list(input);
  }

  create(input: {
    postId: string;
    characterId: string;
    reactionType: string;
    reason: string;
  }) {
    return this.characters.withActivityTransaction(
      input.characterId,
      async () => {
        const result = await this.reactions.create(input);
        if (result.created) {
          await this.actionLogs.record({
            characterId: input.characterId,
            actionType: "POST_REACTION_CREATED",
            targetTable: "post_reactions",
            targetId: result.reaction.id,
            reason: input.reason,
          });
        }
        return result.reaction;
      },
    );
  }
}
