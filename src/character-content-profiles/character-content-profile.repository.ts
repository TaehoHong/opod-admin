import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { DatabaseTransactionContext } from "../core/database/database-transaction-context";
import { characterContentProfiles } from "../core/database/schema";
import { CharacterContentProfile } from "./character-content-profile";

@Injectable()
export class CharacterContentProfileRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  async find(characterId: string) {
    const [row] = await this.transactions
      .currentOr(this.database.client)
      .select({
        accountConcept: characterContentProfiles.accountConcept,
        imageStyle: characterContentProfiles.imageStyle,
        captionStyle: characterContentProfiles.captionStyle,
        constraints: characterContentProfiles.constraints,
      })
      .from(characterContentProfiles)
      .where(eq(characterContentProfiles.characterId, characterId))
      .limit(1);
    return row ?? null;
  }

  async put(characterId: string, profile: CharacterContentProfile) {
    await this.transactions
      .currentOr(this.database.client)
      .insert(characterContentProfiles)
      .values({ characterId, ...profile })
      .onConflictDoUpdate({
        target: characterContentProfiles.characterId,
        set: { ...profile, updatedAt: new Date() },
      });
  }
}
