import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { parseFinishPreset } from "../../worker/film-finish";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { FilmFinishService } from "./film-finish.service";

@Controller("api/media")
@UseGuards(AdminJwtGuard)
export class FilmFinishController {
  constructor(private readonly filmFinishService: FilmFinishService) {}

  // 게시 마감 미리보기 — 초안 검수의 미리보기 토글이 이 바이트를 그대로
  // 표시한다. 결정적 연산이므로 브라우저 캐시를 허용한다.
  @Get(":id/film-finish")
  @Header("Cache-Control", "private, max-age=86400")
  async preview(
    @Param("id") mediaId: string,
    @Query("preset") presetQuery?: string,
  ): Promise<StreamableFile> {
    const preset = parseFinishPreset(presetQuery ?? "film");
    if (!preset) {
      throw new BadRequestException("Unknown finish preset");
    }
    const bytes = await this.filmFinishService.finishedJpeg(mediaId, preset);
    return new StreamableFile(bytes, { type: "image/jpeg" });
  }
}
