#!/usr/bin/env node
// 두 리포의 prisma 스키마 drift를 잡는다.
// canonical = opod-service-backend/prisma/schema.prisma (스키마 소유권은 그쪽에 있다).
// admin 스키마는 canonical의 부분 복사본이어야 한다: admin에 존재하는 모델/enum은
// canonical과 블록 단위로 동일해야 한다 (admin에 없는 모델은 허용 — 부분 복사).
//
// 사용법: node scripts/check-schema-sync.mjs [canonical-schema-path]
// 종료 코드: drift 발견 시 1.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adminSchemaPath = resolve(here, "../prisma/schema.prisma");
const canonicalSchemaPath = resolve(
  here,
  process.argv[2] ?? "../../opod-service-backend/prisma/schema.prisma",
);

const adminBlocks = parseBlocks(readFileSync(adminSchemaPath, "utf8"));
const canonicalBlocks = parseBlocks(readFileSync(canonicalSchemaPath, "utf8"));

const problems = [];
for (const [name, adminBody] of adminBlocks) {
  const canonicalBody = canonicalBlocks.get(name);
  if (canonicalBody === undefined) {
    problems.push(`${name}: admin 스키마에만 존재 (canonical에 없음)`);
    continue;
  }
  if (normalize(adminBody) !== normalize(canonicalBody)) {
    problems.push(`${name}: 정의가 canonical과 다름`);
  }
}

const missing = [...canonicalBlocks.keys()].filter(
  (name) => !adminBlocks.has(name),
);
if (missing.length > 0) {
  console.log(
    `참고: canonical에만 있는 블록 (admin 미사용 — drift 아님): ${missing.join(", ")}`,
  );
}

if (problems.length > 0) {
  console.error(`\n스키마 drift 발견 (${problems.length}건):`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    `\ncanonical(${canonicalSchemaPath})에서 해당 블록을 복사해 동기화하세요.`,
  );
  process.exit(1);
}
console.log(
  `스키마 동기화 OK — admin의 ${adminBlocks.size}개 블록이 canonical과 일치합니다.`,
);

// model/enum 블록을 이름 → 본문으로 파싱한다. 중첩 중괄호는 prisma 스키마에 없다.
function parseBlocks(source) {
  const blocks = new Map();
  const pattern = /^(model|enum)\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(pattern)) {
    blocks.set(`${match[1]} ${match[2]}`, match[3]);
  }
  return blocks;
}

// 주석과 공백 차이는 drift로 치지 않는다 — 실질(필드/속성) 비교.
function normalize(body) {
  return body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("\n");
}
