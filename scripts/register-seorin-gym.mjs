#!/usr/bin/env node
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const refsDir = process.env.SEORIN_GYM_REFS_DIR;
if (!refsDir) throw new Error("SEORIN_GYM_REFS_DIR is required");

for (const key of [
  "DATABASE_URL",
  "S3_BUCKET",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_PUBLIC_BASE_URL",
]) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
const referenceDescriptions = [
  "메인 중앙 통로에서 본 전체 전경. 낮은 노출 천장, 은색 덕트, 보라·파랑·핑크 LED, 검정·빨강 머신의 높은 밀도와 깊은 원근을 보여준다.",
  "긴 벽면 거울 앞 촬영 구역. 거울에 대형 머신 플로어와 구조 기둥, 컬러 LED가 이어져 전신 거울샷 배경으로 사용한다.",
  "하체 머신 구역의 힙 어브덕션/어덕션 머신 시점. 크롬 가이드봉이 있는 검정 핀 머신과 뒤쪽 빨강 플레이트 머신을 함께 보여준다.",
  "머신 플로어 가장자리의 스트레칭 존. 검정 매트와 폼롤러 너머로 같은 컬러 조명과 촘촘한 머신 배치가 이어진다.",
  "거울 옆 검정 벤치에 휴대폰 클램프를 둔 셀프 촬영 시점. 작은 촬영 여백 뒤로 검정·빨강 머신 숲이 보인다.",
];
const locationData = {
  locationKey: "seorin-signature-gym",
  displayName: "서린이 다니는 헬스장",
  description:
    "서린이 촬영 전 바디라인·자세·붓기와 운동복 핏을 관리하고 얼굴 없는 거울 콘텐츠를 촬영하기 위해 다니는 24시간 대형 머신 중심 헬스장. 고중량 기록이나 운동 성취보다 화면에 보이는 컨디션 관리가 목적이다.",
  visualPrompt:
    "Large 24-hour machine-focused Korean commercial gym with a long low-ceilinged single-floor space, exposed concrete, silver HVAC ducts and white pipes, parallel violet-blue and soft-pink linear LED lighting, dark charcoal speckled square rubber tiles, dark gray rectangular columns, long wall mirrors, dense orderly rows of premium equipment mixing black pin-loaded machines with chrome guide rods and red plate-loaded frames, deep sightlines and a brighter window band at the far end. Keep a walkable central aisle and a small clear mirror-shooting area. Slightly dim, busy in equipment density but clean and maintained, with no identifiable brand or location signage.",
  negativePrompt:
    "readable brand text, logo, signage, watermark, minimalist boutique gym, sparse empty floor, white luxury fitness studio, hotel spa, CrossFit warehouse, boxing gym, bodybuilding stage, neon sign, cinematic fog, glossy CGI showroom, fisheye distortion, implausibly wide empty space, duplicated machines, deformed equipment",
};

function pngSize(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG")
    throw new Error("Only PNG references are supported");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
function publicUrl(storageKey) {
  return `${process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function main() {
  await db.connect();
  const character = (
    await db.query("select id from opod.characters where public_id = $1", [
      "seorin",
    ])
  ).rows[0];
  if (!character) throw new Error("Character seorin was not found");

  const location = (
    await db.query(
      `insert into opod.character_locations (character_id, location_key, display_name, description, visual_prompt, negative_prompt)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (character_id, location_key) do update set display_name = excluded.display_name, description = excluded.description,
       visual_prompt = excluded.visual_prompt, negative_prompt = excluded.negative_prompt, deleted_at = null, updated_at = now()
     returning id`,
      [
        character.id,
        locationData.locationKey,
        locationData.displayName,
        locationData.description,
        locationData.visualPrompt,
        locationData.negativePrompt,
      ],
    )
  ).rows[0];
  const referenceCount = Number(
    (
      await db.query(
        "select count(*)::int as count from opod.character_location_references where location_id = $1",
        [location.id],
      )
    ).rows[0].count,
  );
  if (referenceCount === 5 && process.env.REPLACE_LOCATION_REFS !== "1") {
    console.log(`location=${location.id} references=5 (already registered)`);
    await verifyPlannerLookup(character.id, location.id);
    return;
  }
  if (referenceCount > 0 && process.env.REPLACE_LOCATION_REFS !== "1")
    throw new Error(
      "Location has a partial reference set; set REPLACE_LOCATION_REFS=1 to replace it",
    );

  const files = readdirSync(refsDir)
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (files.length !== 5)
    throw new Error(`Expected 5 PNG files, found ${files.length}`);
  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const mediaIds = [];
  for (const fileName of files) {
    const body = readFileSync(path.join(refsDir, fileName));
    const { width, height } = pngSize(body);
    const storageKey = `character-locations/${location.id}/${randomUUID()}.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storageKey,
        Body: body,
        ContentType: "image/png",
      }),
    );
    const row = (
      await db.query(
        `insert into opod.media (media_type, url, storage_key, content_type, byte_size, width, height, uploaded_at)
       values ('image', $1, $2, 'image/png', $3, $4, $5, now()) returning id`,
        [publicUrl(storageKey), storageKey, body.byteLength, width, height],
      )
    ).rows[0];
    mediaIds.push(row.id);
    console.log(`uploaded ${fileName} -> ${row.id}`);
  }

  await db.query("begin");
  try {
    await db.query(
      "delete from opod.character_location_references where location_id = $1",
      [location.id],
    );
    for (const [index, mediaId] of mediaIds.entries()) {
      await db.query(
        "insert into opod.character_location_references (location_id, media_id, sort_order, description) values ($1, $2, $3, $4)",
        [location.id, mediaId, index, referenceDescriptions[index]],
      );
    }
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
  console.log(`location=${location.id} references=${mediaIds.length}`);
  await verifyPlannerLookup(character.id, location.id);
}

async function verifyPlannerLookup(characterId, locationId) {
  const rows = (
    await db.query(
      `select r.media_id, m.uploaded_at, m.storage_key from opod.character_locations l
     join opod.character_location_references r on r.location_id = l.id join opod.media m on m.id = r.media_id
     where l.id = $1 and l.deleted_at is null and (l.character_id is null or l.character_id = $2) order by r.sort_order`,
      [locationId, characterId],
    )
  ).rows;
  if (
    rows.length !== 5 ||
    rows.some((row) => !row.uploaded_at || !row.storage_key)
  )
    throw new Error("Location references are incomplete or not uploaded");
  console.log(
    `verified plannerLookup=visible uploadedReferences=${rows.length}`,
  );
}

try {
  await main();
} finally {
  await db.end().catch(() => undefined);
}
