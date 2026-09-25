import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export class UpsertSocialActivityPolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(LOCAL_TIME)
  activeStartLocalTime!: string;

  @IsString()
  @Matches(LOCAL_TIME)
  activeEndLocalTime!: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  activityIntervalMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  maxDailyPostViews!: number;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  maxDailyPostLikes!: number;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  maxDailyFollows!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1)
  postLikeProbability!: number;
}
