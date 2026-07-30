import { BadRequestException, Injectable } from "@nestjs/common";
import {
  CharacterProfileImage,
  CharacterProfileImageRepository,
} from "./character-profile-image.repository";

type ProfileCrop = {
  x: number;
  y: number;
  zoom: number;
};

const DEFAULT_CROP: ProfileCrop = { x: 0.5, y: 0.5, zoom: 1 };

@Injectable()
export class CharacterProfileImageService {
  constructor(private readonly repository: CharacterProfileImageRepository) {}

  async get(characterId: string): Promise<CharacterProfileImage> {
    const profile = await this.repository.get(characterId);
    if (!profile) {
      throw new BadRequestException("Character not found");
    }
    return profile;
  }

  async set(
    characterId: string,
    input: {
      mediaId: string;
      crop?: ProfileCrop;
    },
  ): Promise<CharacterProfileImage> {
    await this.get(characterId);
    const media = await this.repository.findMedia(input.mediaId);
    if (!media) {
      throw new BadRequestException("Media not found");
    }
    if (!media.uploadedAt) {
      throw new BadRequestException("Media upload is not confirmed");
    }
    if (media.mediaType !== "image") {
      throw new BadRequestException("Profile media must be an image");
    }

    const crop = input.crop ?? DEFAULT_CROP;
    this.assertCrop(crop);
    return this.repository.save(characterId, {
      mediaId: input.mediaId,
      crop,
    });
  }

  async clear(characterId: string): Promise<CharacterProfileImage> {
    await this.get(characterId);
    return this.repository.clear(characterId);
  }

  private assertCrop(crop: ProfileCrop): void {
    if (
      !Number.isFinite(crop.x) ||
      crop.x < 0 ||
      crop.x > 1 ||
      !Number.isFinite(crop.y) ||
      crop.y < 0 ||
      crop.y > 1 ||
      !Number.isFinite(crop.zoom) ||
      crop.zoom < 1 ||
      crop.zoom > 3
    ) {
      throw new BadRequestException(
        "Profile crop must use x/y from 0 to 1 and zoom from 1 to 3",
      );
    }
  }
}
