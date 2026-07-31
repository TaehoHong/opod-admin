// 저장된 미디어 URL이 http(s)가 아니면 미리보기를 만들지 않는다. 로컬 경로나
// s3:// 같은 값이 그대로 <img src>로 들어가는 것을 막는다.
export function previewUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
