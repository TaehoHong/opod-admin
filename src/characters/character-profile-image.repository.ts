import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { characters, media } from "../domain/database/schema";

type ProfileRow = {
  id: string;
  profileImageCropX: number;
  profileImageCropY: number;
  profileImageCropZoom: number;
  profileImage: {
    id: string;
    url: string;
    width: number | null;
    height: number | null;
  } | null;
};

export type CharacterProfileImage = {
  characterId: string;
  image: { id: string; url: string; width?: number; height?: number } | null;
  crop: { x: number; y: number; zoom: number };
};

@Injectable()
export class CharacterProfileImageRepository {
  constructor(private readonly database: DatabaseService) {}

  async get(characterId: string): Promise<CharacterProfileImage | null> {
    const character = await this.findProfile(characterId);
    return character ? this.toProfile(character) : null;
  }

  findMedia(mediaId: string) {
    return this.database.client
      .select({
        id: media.id,
        mediaType: media.mediaType,
        uploadedAt: media.uploadedAt,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async save(
    characterId: string,
    input: { mediaId: string; crop: { x: number; y: number; zoom: number } },
  ): Promise<CharacterProfileImage> {
    await this.database.client
      .update(characters)
      .set({
        profileImageId: input.mediaId,
        profileImageCropX: input.crop.x,
        profileImageCropY: input.crop.y,
        profileImageCropZoom: input.crop.zoom,
      })
      .where(eq(characters.id, characterId));
    return this.toProfile((await this.findProfile(characterId))!);
  }

  async clear(characterId: string): Promise<CharacterProfileImage> {
    await this.database.client
      .update(characters)
      .set({
        profileImageId: null,
        profileImageCropX: 0.5,
        profileImageCropY: 0.5,
        profileImageCropZoom: 1,
      })
      .where(eq(characters.id, characterId));
    return this.toProfile((await this.findProfile(characterId))!);
  }

  private findProfile(characterId: string): Promise<ProfileRow | null> {
    return this.database.client
      .select({
        id: characters.id,
        profileImageCropX: characters.profileImageCropX,
        profileImageCropY: characters.profileImageCropY,
        profileImageCropZoom: characters.profileImageCropZoom,
        profileImage: {
          id: media.id,
          url: media.url,
          width: media.width,
          height: media.height,
        },
      })
      .from(characters)
      .leftJoin(media, eq(media.id, characters.profileImageId))
      .where(eq(characters.id, characterId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  private toProfile(character: ProfileRow): CharacterProfileImage {
    return {
      characterId: character.id,
      image: character.profileImage?.id
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
