import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

const profileSelect = {
  id: true,
  profileImageCropX: true,
  profileImageCropY: true,
  profileImageCropZoom: true,
  profileImage: {
    select: {
      id: true,
      url: true,
      width: true,
      height: true,
    },
  },
} as const;

type ProfileRow = Prisma.CharacterGetPayload<{
  select: typeof profileSelect;
}>;

export type CharacterProfileImage = {
  characterId: string;
  image: {
    id: string;
    url: string;
    width?: number;
    height?: number;
  } | null;
  crop: {
    x: number;
    y: number;
    zoom: number;
  };
};

@Injectable()
export class CharacterProfileImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(characterId: string): Promise<CharacterProfileImage | null> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: profileSelect,
    });
    return character ? this.toProfile(character) : null;
  }

  findMedia(mediaId: string) {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        mediaType: true,
        uploadedAt: true,
      },
    });
  }

  async save(
    characterId: string,
    input: {
      mediaId: string;
      crop: { x: number; y: number; zoom: number };
    },
  ): Promise<CharacterProfileImage> {
    const character = await this.prisma.character.update({
      where: { id: characterId },
      data: {
        profileImageId: input.mediaId,
        profileImageCropX: input.crop.x,
        profileImageCropY: input.crop.y,
        profileImageCropZoom: input.crop.zoom,
      },
      select: profileSelect,
    });
    return this.toProfile(character);
  }

  async clear(characterId: string): Promise<CharacterProfileImage> {
    const character = await this.prisma.character.update({
      where: { id: characterId },
      data: {
        profileImageId: null,
        profileImageCropX: 0.5,
        profileImageCropY: 0.5,
        profileImageCropZoom: 1,
      },
      select: profileSelect,
    });
    return this.toProfile(character);
  }

  private toProfile(character: ProfileRow): CharacterProfileImage {
    return {
      characterId: character.id,
      image: character.profileImage
        ? {
            id: character.profileImage.id,
            url: character.profileImage.url,
            ...(character.profileImage.width
              ? { width: character.profileImage.width }
              : {}),
            ...(character.profileImage.height
              ? { height: character.profileImage.height }
              : {}),
          }
        : null,
      crop: {
        x: character.profileImageCropX,
        y: character.profileImageCropY,
        zoom: character.profileImageCropZoom,
      },
    };
  }
}
