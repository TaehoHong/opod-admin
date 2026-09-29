import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "./app-config.service";

// Global — 설정은 모든 module이 쓰는 횡단 관심사라 module마다 import를
// 반복하지 않는다.
@Global()
@Module({
  providers: [
    { provide: AppConfigService, useFactory: () => new AppConfigService() },
  ],
  exports: [AppConfigService],
})
export class ConfigModule {}
