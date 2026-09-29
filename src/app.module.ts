import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { AdminCsrfGuard } from "./auth/admin-csrf.guard";
import { AdminModule } from "./administration/admin.module";
import { AllExceptionsFilter } from "./shared/filters/all-exceptions.filter";
import { ConfigModule } from "./core/config/config.module";
import { HttpLoggerMiddleware } from "./shared/middleware/http-logger.middleware";
import { HealthModule } from "./health/health.module";
import { PostProductionModule } from "./post-production/post-production.module";

@Module({
  imports: [ConfigModule, AdminModule, HealthModule, PostProductionModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 상태를 바꾸는 모든 경로에 Origin/고정 헤더 검사를 적용한다. 컨트롤러가
    // 늘어도 빠지지 않도록 전역으로 건다 (docs/06-architecture.md:124).
    { provide: APP_GUARD, useClass: AdminCsrfGuard },
    // DI-provided (instead of app.useGlobalPipes) so e2e apps built from
    // AppModule get the same validation behavior as production.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes("*");
  }
}
