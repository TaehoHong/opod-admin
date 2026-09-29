import { Injectable, Logger, NestMiddleware } from "@nestjs/common";

interface LoggedRequest {
  method: string;
  originalUrl: string;
}

interface LoggedResponse {
  statusCode: number;
  on(event: "finish", listener: () => void): void;
}

// ponytail: 성공한 읽기 요청은 남기지 않는다 (GCP DATA_READ / CloudTrail data event 기본값).
// 실패는 메서드와 무관하게 남긴다 — 401/403 GET은 보안 이벤트라서.
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Logs every `/api/*` write with its response status and duration, plus any
// failed request. Runs as middleware (not an interceptor) so guard rejections
// (401) and unmatched routes (404) are logged too.
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: LoggedRequest, res: LoggedResponse, next: () => void) {
    if (!req.originalUrl.startsWith("/api")) {
      next();
      return;
    }

    const startedAt = Date.now();
    const isWrite = !READ_METHODS.has(req.method);

    if (isWrite) {
      this.logger.log(`→ ${req.method} ${req.originalUrl}`);
    }

    res.on("finish", () => {
      const message = `← ${req.method} ${req.originalUrl} ${res.statusCode} ${
        Date.now() - startedAt
      }ms`;
      if (res.statusCode >= 500) {
        this.logger.error(message);
      } else if (res.statusCode >= 400) {
        this.logger.warn(message);
      } else if (isWrite) {
        this.logger.log(message);
      }
    });

    next();
  }
}
