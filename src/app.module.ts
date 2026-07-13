import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { HttpLoggerMiddleware } from "./common/http-logger.middleware";
import { WorkerModule } from "./worker/worker.module";

@Module({
  imports: [AdminModule, WorkerModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
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
