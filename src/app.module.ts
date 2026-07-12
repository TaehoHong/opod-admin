import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { HttpLoggerMiddleware } from "./common/http-logger.middleware";

@Module({
  imports: [AdminModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes("*");
  }
}
