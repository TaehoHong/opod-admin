import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../domain/database/prisma.service";
import {
  applyFinish,
  downloadMediaBytes,
  FinishPreset,
  mediaSourceBytes,
} from "../../worker/film-finish";
import { ReferenceUrlSigner } from "../../worker/generated-media-store";

// 결정적 연산이라 캐시는 정합성 문제 없이 순수 성능용이다.
// 초안 검수에서 토글을 켰다 껐다 해도 미디어·프리셋당 한 번만 렌더링한다.
const CACHE_MAX_ENTRIES = 32;

// 초안 검수의 게시 마감 미리보기 — 미디어 원본을 받아 후보정 JPEG을
// 돌려준다. 게시 단계(draft-worker)가 같은 연산을 그대로 적용하므로,
// 여기서 본 모습이 게시물에 나가는 모습이다. 저장된 후보(Media 원본)는
// 건드리지 않는다.
@Injectable()
export class FilmFinishService {
  private readonly cache = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly prisma: PrismaService,
    // 비공개 S3 객체는 presigned URL로 읽는다 (레퍼런스 전달과 동일 방식).
    private readonly signReferenceUrl: ReferenceUrlSigner | null = null,
    private readonly fetchBytes: (
      url: string,
    ) => Promise<Buffer> = downloadMediaBytes,
  ) {}

  async finishedJpeg(mediaId: string, preset: FinishPreset): Promise<Buffer> {
    const key = `${preset}:${mediaId}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const pending = this.render(mediaId, preset);
    this.cache.set(key, pending);
    // 실패(일시적 다운로드 오류 등)는 캐시에 남기지 않는다.
    pending.catch(() => this.cache.delete(key));
    if (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) {
        this.cache.delete(oldest);
      }
    }
    return pending;
  }

  private async render(
    mediaId: string,
    preset: FinishPreset,
  ): Promise<Buffer> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { mediaType: true, url: true, storageKey: true },
    });
    if (!media) {
      throw new NotFoundException("Media not found");
    }
    if (media.mediaType !== "image") {
      throw new BadRequestException(
        "Finish preview supports image media only",
      );
    }
    const source = await mediaSourceBytes(
      media,
      this.signReferenceUrl,
      this.fetchBytes,
    );
    return applyFinish(source, preset);
  }
}
