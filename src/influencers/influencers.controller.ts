import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { parsePageQuery } from "../shared/utils/page";
import { InfluencerService } from "./influencer.service";
import { InfluencerMediaApplicationService } from "./influencer-media-application.service";
import { MAX_REFERENCE_BYTES } from "./influencer-media-store";
import { parseMediaMetadata, RegisterInfluencer } from "./influencer-input";
@Controller("api/admin/v1")
@UseGuards(AdminJwtGuard)
export class InfluencersController {
  constructor(
    private readonly influencers: InfluencerService,
    private readonly media: InfluencerMediaApplicationService,
  ) {}
  @Get("influencers") list(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
    @Query("characterId") characterId?: string,
  ) {
    const page = parsePageQuery(cursor, limit);
    return this.influencers.list(page.cursor, page.limit, search, characterId);
  }
  @Post("influencers")
  async create(@Body() input: RegisterInfluencer) {
    if (typeof input?.url !== "string" || input.url.length > 2048)
      throw new BadRequestException("Instagram 계정 링크를 입력해 주세요.");
    const row = await this.influencers.register(input.url);
    return { ...row, id: String(row.id) };
  }
  @Get("influencer-media") mediaList(
    @Query() query: Parameters<InfluencerMediaApplicationService["list"]>[0],
  ) {
    return this.media.list(query);
  }
  @Post("influencer-media")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_REFERENCE_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 20000,
      },
    }),
  )
  async register(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body("metadata") metadata: unknown,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ) {
    if (!file?.buffer) throw new BadRequestException("file is required");
    const result = await this.media.register(
      parseMediaMetadata(metadata),
      file.buffer,
    );
    response.status(result.created ? 201 : 200);
    return result;
  }
}
