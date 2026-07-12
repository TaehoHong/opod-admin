import { Injectable, Logger, NestMiddleware } from "@nestjs/common";

interface LoggedRequest {
  method: string;
  originalUrl: string;
}

interface LoggedResponse {
  statusCode: number;
  on(event: "finish", listener: () => void): void;
}

// Logs every `/api/*` request with its response status and duration.
// Runs as middleware (not an interceptor) so guard rejections (401) and
// unmatched routes (404) are logged too.
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: LoggedRequest, res: LoggedResponse, next: () => void) {
    if (!req.originalUrl.startsWith("/api")) {
      next();
      return;
    }

    const startedAt = Date.now();
    this.logger.log(`→ ${req.method} ${req.originalUrl}`);

    res.on("finish", () => {
      const message = `← ${req.method} ${req.originalUrl} ${res.statusCode} ${
        Date.now() - startedAt
      }ms`;
      if (res.statusCode >= 500) {
        this.logger.error(message);
      } else if (res.statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}
