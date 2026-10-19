import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { AdminJwtGuard, AdminRequest } from "../auth/admin-jwt.guard";
import { AiProvider } from "../settings/ai-management";
import { AiManagementService } from "./ai-management.service";

class RevisionDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  expectedRevision!: string | null;
}
class ConnectionDto extends RevisionDto {
  @IsIn(["llm", "image"]) type!: "llm" | "image";
  @IsIn(["openai-compatible", "openai", "spicyapi", "fal", "opod-flux"])
  provider!: AiProvider;
  @IsString() @MaxLength(1000) apiUrl!: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string | null;
}
class ModelDto extends RevisionDto {
  @IsString() @MaxLength(512) model!: string;
}
class AssignmentDto extends RevisionDto {
  @IsString() @MaxLength(100) connectionId!: string;
  @IsString() @MaxLength(100) modelId!: string;
}
class ProbeDto {
  @IsOptional() @IsString() @MaxLength(1000) apiUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(100) modelId?: string;
}

@UseGuards(AdminJwtGuard)
@Controller("api/admin/v1/ai-management")
export class AiManagementController {
  constructor(private readonly management: AiManagementService) {}
  @Get() get() {
    return this.management.get();
  }
  @Post("connections") create(
    @Body() body: ConnectionDto,
    @Req() request: AdminRequest,
  ) {
    return this.management.saveConnection(
      null,
      body,
      body.expectedRevision,
      request.admin!.email,
    );
  }
  @Put("connections/:id") update(
    @Param("id") id: string,
    @Body() body: ConnectionDto,
    @Req() request: AdminRequest,
  ) {
    return this.management.saveConnection(
      id,
      body,
      body.expectedRevision,
      request.admin!.email,
    );
  }
  @Delete("connections/:id") remove(
    @Param("id") id: string,
    @Body() body: RevisionDto,
    @Req() request: AdminRequest,
  ) {
    return this.management.removeConnection(
      id,
      body.expectedRevision,
      request.admin!.email,
    );
  }
  @Post("connections/:id/models") addModel(
    @Param("id") id: string,
    @Body() body: ModelDto,
    @Req() request: AdminRequest,
  ) {
    return this.management.addModel(
      id,
      body.model,
      body.expectedRevision,
      request.admin!.email,
    );
  }
  @Delete("connections/:id/models/:modelId") removeModel(
    @Param("id") id: string,
    @Param("modelId") modelId: string,
    @Body() body: RevisionDto,
    @Req() request: AdminRequest,
  ) {
    return this.management.removeModel(
      id,
      modelId,
      body.expectedRevision,
      request.admin!.email,
    );
  }
  @Put("features/:id") assign(
    @Param("id") id: string,
    @Body() body: AssignmentDto,
    @Req() request: AdminRequest,
  ) {
    return this.management.assign(
      id,
      body.connectionId,
      body.modelId,
      body.expectedRevision,
      request.admin!.email,
    );
  }
  @Post("connections/:id/test") test(
    @Param("id") id: string,
    @Body() body: ProbeDto,
  ) {
    return this.management.test(id, body);
  }
  @Post("connections/:id/discover-models") discover(
    @Param("id") id: string,
    @Body() body: ProbeDto,
  ) {
    return this.management.discover(id, body);
  }
}
