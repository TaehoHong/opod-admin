// 모든 HTTP는 이 wrapper를 통한다 — feature의 UI나 query 코드가 직접 fetch를
// 호출하지 않는다 (docs/06-architecture.md "Frontend").
//
// 세션은 HttpOnly cookie라 JavaScript가 읽을 수 없다. 매 요청에 same-origin
// cookie를 붙이고, 상태를 바꾸는 요청에는 서버가 요구하는 고정 헤더를 싣는다
// (docs/06-architecture.md "Authentication and Web Security").

export const API_BASE = "/api/admin/v1";
export const ADMIN_REQUEST_HEADER = "x-opod-admin";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

// Nest 기본 오류 구조를 공통 형식으로 정규화한다
// (docs/02-development-rules.md "Validation, Errors, Config and Logs").
function errorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") {
      return message.join(", ");
    }
  }
  return `Request failed with status ${status}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      [ADMIN_REQUEST_HEADER]: "1",
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const text = await response.text();
  const payload: unknown = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(response.status, payload));
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
