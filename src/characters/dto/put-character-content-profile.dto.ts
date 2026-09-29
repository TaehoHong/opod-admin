import { IsString, MaxLength } from "class-validator";
import { CharacterContentProfile } from "../../character-content-profiles/character-content-profile";

export class PutCharacterContentProfileDto implements CharacterContentProfile {
  @IsString()
  @MaxLength(10000)
  accountConcept!: string;

  @IsString()
  @MaxLength(10000)
  imageStyle!: string;

  @IsString()
  @MaxLength(10000)
  captionStyle!: string;

  @IsString()
  @MaxLength(10000)
  constraints!: string;
}
