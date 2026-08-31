#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adminSchemaPath = resolve(here, "../src/domain/database/schema.ts");
const canonicalSchemaPath = resolve(
  here,
  process.argv[2] ?? "../../opod-service-backend/src/domain/database/schema.ts",
);

const normalize = (source) => source.replace(/\r\n/g, "\n").trim();
const adminSchema = normalize(readFileSync(adminSchemaPath, "utf8"));
const canonicalSchema = normalize(readFileSync(canonicalSchemaPath, "utf8"));

if (adminSchema !== canonicalSchema) {
  console.error(
    `Drizzle 스키마 drift 발견: ${adminSchemaPath}\ncanonical: ${canonicalSchemaPath}`,
  );
  process.exit(1);
}

console.log("Drizzle 정본 스키마가 canonical과 일치합니다.");
