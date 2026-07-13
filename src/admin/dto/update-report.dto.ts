import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdateReportDto {
  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}
