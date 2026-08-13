// OpenAI 호환 structured outputs(`response_format.json_schema`, strict)가 받는
// JSON Schema는 표준의 부분집합이다. 2026-08-13 실제 프로바이더 응답으로 확인한
// 제약:
//
// - 루트는 반드시 `type: "object"`다. 루트 `oneOf`/`anyOf`는 거부된다.
// - `oneOf`는 어느 위치에서도 허용되지 않는다. union은 `anyOf`로 쓴다.
// - `uniqueItems`는 허용되지 않는다 (배열 제약은 minItems/maxItems만).
// - `const`는 `type` 없이 단독으로 쓸 수 없다. 단일 값은 enum으로 표현한다.
// - 허용: enum, 중첩 anyOf(널 허용 포함), string minLength/maxLength,
//   number/integer minimum/maximum, array minItems/maxItems.
//
// 이 모듈은 그 제약 안에서 판별 union 계약을 표현하는 방법과, 스키마가 제약을
// 지키는지 검사하는 함수를 소유한다. 프로바이더 문법 제약이 각 Agent 프롬프트에
// 흩어지지 않게 한다.

// union을 감쌀 때 쓰는 예약 키. 전송 계층에서만 존재하며 Agent 파서는 보지 않는다.
export const UNION_ENVELOPE_KEY = "result";

// 판별 union을 루트 object 한 겹으로 감싼다. 루트에 anyOf를 둘 수 없다는 제약만
// 우회할 뿐, 각 variant의 계약은 그대로다.
export function rootUnionSchema(
  variants: readonly unknown[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { [UNION_ENVELOPE_KEY]: { anyOf: [...variants] } },
    required: [UNION_ENVELOPE_KEY],
    additionalProperties: false,
  };
}

// rootUnionSchema가 만든 스키마인지 판별한다. 전송 계층이 응답을 자동으로 벗기는
// 근거이므로, 감싼 쪽과 벗기는 쪽이 어긋날 수 없다.
export function isRootUnionSchema(schema: unknown): boolean {
  if (!isRecord(schema) || schema.type !== "object") return false;
  const properties = schema.properties;
  if (!isRecord(properties)) return false;
  const keys = Object.keys(properties);
  if (keys.length !== 1 || keys[0] !== UNION_ENVELOPE_KEY) return false;
  return Array.isArray(
    (properties[UNION_ENVELOPE_KEY] as Record<string, unknown>)?.anyOf,
  );
}

// 프로바이더가 거부하는 문법을 쓰고 있으면 던진다. 네트워크 호출 전에 배포된
// 스키마의 호환성을 확인하는 용도 — 실패는 프로바이더 장애가 아니라 우리 버그다.
export function assertStrictSchemaCompatible(
  schema: unknown,
  label: string,
): void {
  if (!isRecord(schema) || schema.type !== "object") {
    throw new Error(`${label}: 루트는 type "object"여야 합니다`);
  }
  walk(schema, label, "");
}

function walk(node: unknown, label: string, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, label, `${path}[${index}]`));
    return;
  }
  if (!isRecord(node)) return;
  const at = path || "(root)";
  if ("oneOf" in node) {
    throw new Error(`${label}: ${at}에 oneOf가 있습니다 (anyOf만 허용)`);
  }
  if ("uniqueItems" in node) {
    throw new Error(`${label}: ${at}에 uniqueItems가 있습니다 (미지원)`);
  }
  if ("const" in node && !("type" in node)) {
    throw new Error(`${label}: ${at}의 const에 type이 없습니다 (enum 사용)`);
  }
  if (node.type === "object") {
    if (node.additionalProperties !== false) {
      throw new Error(
        `${label}: ${at}에 additionalProperties:false가 없습니다`,
      );
    }
    const properties = isRecord(node.properties) ? node.properties : {};
    const required = Array.isArray(node.required) ? node.required : [];
    const propertyKeys = Object.keys(properties);
    const missing = propertyKeys.filter((key) => !required.includes(key));
    if (missing.length) {
      throw new Error(
        `${label}: ${at}의 ${missing.join(", ")}가 required에 없습니다 (전 필드 필수)`,
      );
    }
  }
  for (const [key, value] of Object.entries(node)) {
    walk(value, label, path ? `${path}.${key}` : key);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
