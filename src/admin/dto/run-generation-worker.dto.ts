import { IsOptional, IsUUID } from "class-validator";

export class RunGenerationWorkerDto {
  // 지정하면 해당 queued 잡을, 없으면 다음 queued 잡을 실행한다.
  @IsOptional()
  @IsUUID()
  jobId?: string;
}
