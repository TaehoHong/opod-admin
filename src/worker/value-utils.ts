// undici fetch는 실패 원인(DNS/타임아웃/TLS 등)을 cause 체인에 숨겨
// "fetch failed"만 남는다 — 진단이 가능하도록 원인 체인을 이어 붙인다.
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts = [error.message];
  // target ES2021에는 Error.cause 타이핑이 없어 구조적 캐스트로 읽는다.
  let cause: unknown = (error as { cause?: unknown }).cause;
  for (let depth = 0; depth < 3 && cause != null; depth += 1) {
    if (cause instanceof AggregateError && cause.errors.length > 0) {
      cause = cause.errors[0];
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message && message !== parts[parts.length - 1]) {
      parts.push(message);
    }
    cause =
      cause instanceof Error ? (cause as { cause?: unknown }).cause : undefined;
  }
  return parts.join(" ← ");
}

export function parsePositiveNumber(
  value: string | undefined,
): number | undefined {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
