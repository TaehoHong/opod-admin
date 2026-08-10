import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsString, ValidateNested } from "class-validator";

class UpdateDraftPromptItemDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsString()
  @IsNotEmpty()
  prompt!: string;
}

export class UpdateDraftPromptsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateDraftPromptItemDto)
  items!: UpdateDraftPromptItemDto[];
}
