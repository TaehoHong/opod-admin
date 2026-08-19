import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { assertUploadedMediaRow } from "../media/media.service";
import {
  DuplicateLocationKeyError,
  LocationRow,
  LocationsRepository,
  LocationScope,
} from "./locations.repository";
import {
  decodeCursor,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";

const REFERENCE_MAX_COUNT = 20;

@Injectable()
export class LocationsService {
  constructor(private readonly locations: LocationsRepository) {}

  async list(input: PageInput & { characterId?: string; scope?: string }) {
    const scope = this.parseScope(input.scope);
    const cursorId = decodeCursor(input.cursor);
    const filter = {
      ...(input.characterId?.trim()
        ? { characterId: input.characterId.trim() }
        : {}),
      scope,
    };
    if (
      cursorId &&
      !(await this.locations.cursorMatchesFilter(cursorId, filter))
    ) {
      throw new BadRequestException("Invalid cursor for location filter");
    }
    const rows = await this.locations.findMany({
      ...filter,
      take: input.limit + 1,
      ...(cursorId ? { cursorId } : {}),
    });
    return pageFromRows(
      rows.map((row) => this.toLocation(row)),
      input.limit,
    );
  }

  async get(locationId: string) {
    return this.toLocation(await this.requireLocation(locationId));
  }

  async create(input: {
    characterId?: string | null;
    locationKey: string;
    displayName: string;
    description: string;
    visualPrompt: string;
    negativePrompt?: string;
    referenceNegativePrompt?: string;
  }) {
    const data = {
      characterId: this.characterId(input.characterId),
      locationKey: input.locationKey.trim(),
      displayName: this.required(input.displayName, "Display name"),
      description: input.description.trim(),
      visualPrompt: input.visualPrompt.trim(),
      negativePrompt: input.negativePrompt?.trim() ?? "",
      referenceNegativePrompt: input.referenceNegativePrompt?.trim() ?? "",
    };
    await this.assertCharacter(data.characterId);
    return this.handleDuplicate(() => this.locations.create(data));
  }

  async update(
    locationId: string,
    input: {
      characterId?: string | null;
      locationKey?: string;
      displayName?: string;
      description?: string;
      visualPrompt?: string;
      negativePrompt?: string;
      referenceNegativePrompt?: string;
    },
  ) {
    await this.requireLocation(locationId);
    const data = {
      ...(input.characterId !== undefined
        ? { characterId: this.characterId(input.characterId) }
        : {}),
      ...(input.locationKey !== undefined
        ? { locationKey: input.locationKey.trim() }
        : {}),
      ...(input.displayName !== undefined
        ? { displayName: this.required(input.displayName, "Display name") }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() }
        : {}),
      ...(input.visualPrompt !== undefined
        ? { visualPrompt: input.visualPrompt.trim() }
        : {}),
      ...(input.negativePrompt !== undefined
        ? { negativePrompt: input.negativePrompt.trim() }
        : {}),
      ...(input.referenceNegativePrompt !== undefined
        ? { referenceNegativePrompt: input.referenceNegativePrompt.trim() }
        : {}),
    };
    if (input.characterId !== undefined) {
      await this.assertCharacter(data.characterId ?? null);
    }
    return this.handleDuplicate(() => this.locations.update(locationId, data));
  }

  async delete(locationId: string) {
    await this.requireLocation(locationId);
    await this.locations.softDelete(locationId);
    return { id: locationId, deletedAt: new Date().toISOString() };
  }

  async setReferences(
    locationId: string,
    references: Array<{ mediaId: string; description: string }>,
  ) {
    await this.requireLocation(locationId);
    if (references.length > REFERENCE_MAX_COUNT) {
      throw new BadRequestException(
        `Location references must be ${REFERENCE_MAX_COUNT} or fewer`,
      );
    }
    if (
      new Set(references.map((item) => item.mediaId)).size !== references.length
    ) {
      throw new BadRequestException(
        "Location reference mediaIds must be unique",
      );
    }
    const normalized = references.map((item) => ({
      mediaId: item.mediaId,
      description: item.description.trim(),
    }));
    for (const reference of normalized) {
      assertUploadedMediaRow(
        await this.locations.findUploadedMedia(reference.mediaId),
        "image",
      );
    }
    return this.toLocation(
      await this.locations.replaceReferences(locationId, normalized),
    );
  }

  private parseScope(value?: string): LocationScope {
    const scope = value?.trim() || "all";
    if (scope !== "all" && scope !== "global" && scope !== "character") {
      throw new BadRequestException(
        "Location scope must be all, global, or character",
      );
    }
    return scope;
  }

  private characterId(value?: string | null): string | null {
    return value?.trim() || null;
  }

  private async assertCharacter(characterId: string | null): Promise<void> {
    if (characterId && !(await this.locations.characterExists(characterId))) {
      throw new BadRequestException("Character not found");
    }
  }

  private async requireLocation(locationId: string): Promise<LocationRow> {
    const location = await this.locations.findById(locationId);
    if (!location) throw new BadRequestException("Location not found");
    return location;
  }

  private required(value: string, label: string): string {
    const text = value.trim();
    if (!text) throw new BadRequestException(`${label} is required`);
    return text;
  }

  private async handleDuplicate(action: () => Promise<LocationRow>) {
    try {
      return this.toLocation(await action());
    } catch (error) {
      if (error instanceof DuplicateLocationKeyError) {
        throw new ConflictException(
          "Location key already exists in this scope",
        );
      }
      throw error;
    }
  }

  private toLocation(row: LocationRow) {
    return {
      id: row.id,
      characterId: row.characterId,
      character: row.character,
      locationKey: row.locationKey,
      displayName: row.displayName,
      description: row.description,
      visualPrompt: row.visualPrompt,
      negativePrompt: row.negativePrompt,
      referenceNegativePrompt: row.referenceNegativePrompt,
      referenceCount: row.references.length,
      references: row.references.map((reference) => ({
        mediaId: reference.mediaId,
        url: reference.media.url,
        width: reference.media.width,
        height: reference.media.height,
        uploadedAt: reference.media.uploadedAt?.toISOString() ?? null,
        sortOrder: reference.sortOrder,
        description: reference.description,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
