// 관리자 세션 cookie 계약 (docs/06-architecture.md "Authentication and Web
// Security"). cookie-parser 같은 의존성을 들이지 않고 헤더를 직접 다룬다.

// __Host- prefix는 Secure, Path=/, Domain 없음을 강제한다. 브라우저는
// http://localhost를 trustworthy origin으로 취급하므로 로컬 개발에서도
// 동작한다.
export const ADMIN_SESSION_COOKIE = "__Host-opod_admin_session";

// 브라우저가 cross-origin 요청에 임의로 붙일 수 없는 고정 헤더. CORS를 열지
// 않으므로 preflight도 통과하지 못한다 — 별도 CSRF 토큰이 필요 없는 이유다.
export const ADMIN_REQUEST_HEADER = "x-opod-admin";

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export function serializeSessionCookie(token: string): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${SEVEN_DAYS_SECONDS}`,
  ].join("; ");
}

// logout은 서버 측 무효화 목록 없이 cookie를 제거한다.
export function clearSessionCookie(): string {
  return [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

export function readSessionCookie(cookieHeader?: string): string {
  for (const part of String(cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}
