import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../domain/database/prisma.service";
import {
  assertableMediaFields,
  type AssertableMedia,
} from "../media/media.service";

const locationInclude = {
  character: { select: { id: true, displayName: true, publicId: true } },
  references: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      media: {
        select: {
          id: true,
          url: true,
          width: true,
          height: true,
          uploadedAt: true,
        },
      },
    },
  },
} as const;

export type LocationRow = Prisma.CharacterLocationGetPayload<{
  include: typeof locationInclude;
}>;

export type LocationScope = "all" | "global" | "character";

export class DuplicateLocationKeyError extends Error {}

@Injectable()
export class LocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  characterExists(characterId: string): Promise<boolean> {
    return this.prisma.character
      .findUnique({ where: { id: characterId }, select: { id: true } })
      .then((row) => row !== null);
  }

  findUploadedMedia(mediaId: string): Promise<AssertableMedia | null> {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: assertableMediaFields,
    });
  }

  cursorMatchesFilter(
    cursorId: string,
    filter: { characterId?: string; scope: LocationScope },
  ): Promise<boolean> {
    return this.prisma.characterLocation
      .findFirst({
        where: { id: cursorId, deletedAt: null, ...this.scopeWhere(filter) },
        select: { id: true },
      })
      .then((row) => row !== null);
  }

  findMany(input: {
    characterId?: string;
    scope: LocationScope;
    take: number;
    cursorId?: string;
  }): Promise<LocationRow[]> {
    return this.prisma.characterLocation.findMany({
      where: { deletedAt: null, ...this.scopeWhere(input) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      include: locationInclude,
    });
  }

  findById(locationId: string): Promise<LocationRow | null> {
    return this.prisma.characterLocation.findFirst({
      where: { id: locationId, deletedAt: null },
      include: locationInclude,
    });
  }

  async create(data: {
    characterId: string | null;
    locationKey: string;
    displayName: string;
    description: string;
    visualPrompt: string;
    negativePrompt: string;
  }): Promise<LocationRow> {
    try {
      return await this.prisma.characterLocation.create({
        data,
        include: locationInclude,
      });
    } catch (error) {
      this.rethrowDuplicate(error, data.locationKey);
    }
  }

  async update(
    locationId: string,
    data: {
      characterId?: string | null;
      locationKey?: string;
      displayName?: string;
      description?: string;
      visualPrompt?: string;
      negativePrompt?: string;
    },
  ): Promise<LocationRow> {
    try {
      return await this.prisma.characterLocation.update({
        where: { id: locationId },
        data,
        include: locationInclude,
      });
    } catch (error) {
      this.rethrowDuplicate(error, data.locationKey ?? "");
    }
  }

  async softDelete(locationId: string): Promise<void> {
    await this.prisma.characterLocation.update({
      where: { id: locationId },
      data: { deletedAt: new Date() },
    });
  }

  replaceReferences(
    locationId: string,
    references: Array<{ mediaId: string; description: string }>,
  ): Promise<LocationRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.characterLocationReference.deleteMany({
        where: {
          locationId,
          ...(references.length > 0
            ? { mediaId: { notIn: references.map((item) => item.mediaId) } }
            : {}),
        },
      });
      for (const [index, reference] of references.entries()) {
        await tx.characterLocationReference.upsert({
          where: {
            locationId_mediaId: { locationId, mediaId: reference.mediaId },
          },
          create: {
            locationId,
            mediaId: reference.mediaId,
            description: reference.description,
            sortOrder: (index + 1) * 10,
          },
          update: {
            description: reference.description,
            sortOrder: (index + 1) * 10,
          },
        });
      }
      return tx.characterLocation.findUniqueOrThrow({
        where: { id: locationId },
        include: locationInclude,
      });
    });
  }

  private scopeWhere(input: {
    characterId?: string;
    scope: LocationScope;
  }): Prisma.CharacterLocationWhereInput {
    if (input.characterId) return { characterId: input.characterId };
    if (input.scope === "global") return { characterId: null };
    if (input.scope === "character") return { characterId: { not: null } };
    return {};
  }

  private rethrowDuplicate(error: unknown, locationKey: string): never {
    if ((error as { code?: string }).code === "P2002") {
      throw new DuplicateLocationKeyError(locationKey);
    }
    throw error;
  }
}
