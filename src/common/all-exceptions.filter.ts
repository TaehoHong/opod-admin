import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";

interface FilteredRequest {
  method: string;
  originalUrl: string;
}

interface FilteredResponse {
  status(code: number): { json(body: unknown): void };
}

// Logs every exception (stack traces for 5xx) while preserving Nest's
// default error response shape so API clients and e2e tests see no change.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FilteredRequest>();
    const response = ctx.getResponse<FilteredResponse>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: "Internal server error" };

    const summary = `${request.method} ${request.originalUrl} → ${status}`;
    if (status >= 500) {
      this.logger.error(
        summary,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${summary} — ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
      );
    }

    response
      .status(status)
      .json(typeof body === "string" ? { statusCode: status, message: body } : body);
  }
}
