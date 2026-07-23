import { IsIn } from "class-validator";

export class UpdateShotOutputFilterDto {
  @IsIn(["none", "film", "mono-film"])
  filterPreset!: string;
}
