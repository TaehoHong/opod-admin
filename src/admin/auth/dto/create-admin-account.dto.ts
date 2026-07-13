import { IsNotEmpty, IsString } from "class-validator";

export class CreateAdminAccountDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
