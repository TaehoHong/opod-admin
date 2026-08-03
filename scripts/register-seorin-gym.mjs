#!/usr/bin/env node
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const refsDir = process.env.SEORIN_GYM_REFS_DIR;

if (!refsDir) throw new Error("SEORIN_GYM_REFS_DIR is required");

const required = [
  "DATABASE_URL",
  "S3_BUCKET",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_PUBLIC_BASE_URL",
];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

const referenceDescriptions = [
  "메인 중앙 통로에서 본 전체 전경. 낮은 노출 천장, 은색 덕트, 보라·파랑·핑크 LED, 검정·빨강 머신의 높은 밀도와 깊은 원근을 보여준다.",
  "긴 벽면 거울 앞 촬영 구역. 거울에 대형 머신 플로어와 구조 기둥, 컬러 LED가 이어져 전신 거울샷 배경으로 사용한다.",
  "하체 머신 구역의 힙 어브덕션/어덕션 머신 시점. 크롬 가이드봉이 있는 검정 핀 머신과 뒤쪽 빨강 플레이트 머신을 함께 보여준다.",
  "머신 플로어 가장자리의 스트레칭 존. 검정 매트와 폼롤러 너머로 같은 컬러 조명과 촘촘한 머신 배치가 이어진다.",
  "거울 옆 검정 벤치에 휴대폰 클램프를 둔 셀프 촬영 시점. 작은 촬영 여백 뒤로 검정·빨강 머신 숲이 보인다.",
];

const locationData = {
  locationKey: "jibangbusuri-buldang-gym",
  displayName: "지방부수리 불당점",
  description:
    "천안 불당동의 365일 24시간 대형 머신 중심 헬스장. 서린은 고중량 기록보다 촬영 전 바디라인·자세·붓기와 운동복 핏을 관리하고 거울 콘텐츠를 촬영하기 위해 이용한다.",
  visualPrompt:
    "Large 450-pyeong 24-hour machine-focused gym in Buldang-dong, Cheonan, inspired by the real Jibangbusuri Buldang interior. Long low-ceilinged single-floor space with exposed concrete, silver HVAC ducts and white pipes, parallel violet-blue and soft-pink linear LED lighting, dark charcoal speckled square rubber tiles, dark gray rectangular columns, long wall mirrors, dense orderly rows of premium equipment mixing black pin-loaded machines with chrome guide rods and red plate-loaded frames, deep sightlines and a brighter window band at the far end. Keep a walkable central aisle and a small clear mirror-shooting area. Realistic Korean commercial gym, slightly dim, busy in equipment density but clean and maintained.",
  negativePrompt:
    "readable brand text, logo, signage, watermark, minimalist boutique gym, sparse empty floor, white luxury fitness studio, hotel spa, CrossFit warehouse, boxing gym, bodybuilding stage, neon sign, cinematic fog, glossy CGI showroom, fisheye distortion, implausibly wide empty space, duplicated machines, deformed equipment",
};

function pngSize(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Only PNG references are supported");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function publicUrl(storageKey) {
  const base = process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function main() {
  const character = await prisma.character.findUnique({
    where: { publicId: "seorin" },
    select: { id: true },
  });
  if (!character) throw new Error("Character seorin was not found");

  const location = await prisma.characterLocation.upsert({
    where: {
      characterId_locationKey: {
        characterId: character.id,
        locationKey: locationData.locationKey,
      },
    },
    create: { characterId: character.id, ...locationData },
    update: { ...locationData, deletedAt: null },
    include: { references: true },
  });

  if (location.references.length === 5 && process.env.REPLACE_LOCATION_REFS !== "1") {
    console.log(`location=${location.id} references=5 (already registered)`);
    await verifyPlannerLookup(character.id, location.id);
    return;
  }
  if (location.references.length > 0 && process.env.REPLACE_LOCATION_REFS !== "1") {
    throw new Error("Location has a partial reference set; set REPLACE_LOCATION_REFS=1 to replace it");
  }

  const files = readdirSync(refsDir).filter((name) => name.endsWith(".png")).sort();
  if (files.length !== 5) throw new Error(`Expected 5 PNG files, found ${files.length}`);

  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const createdMediaIds = [];
  for (const [sortOrder, fileName] of files.entries()) {
    const body = readFileSync(path.join(refsDir, fileName));
    const { width, height } = pngSize(body);
    const storageKey = `character-locations/${location.id}/${randomUUID()}.png`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: "image/png",
    }));
    const media = await prisma.media.create({
      data: {
        mediaType: "image",
        url: publicUrl(storageKey),
        storageKey,
        contentType: "image/png",
        byteSize: body.byteLength,
        width,
        height,
        uploadedAt: new Date(),
      },
      select: { id: true },
    });
    createdMediaIds.push(media.id);
    console.log(`uploaded ${fileName} -> ${media.id}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.characterLocationReference.deleteMany({ where: { locationId: location.id } });
    await tx.characterLocationReference.createMany({
      data: createdMediaIds.map((mediaId, sortOrder) => ({
        locationId: location.id,
        mediaId,
        sortOrder,
        description: referenceDescriptions[sortOrder],
      })),
    });
  });
  console.log(`location=${location.id} references=${createdMediaIds.length}`);
  await verifyPlannerLookup(character.id, location.id);
}

async function verifyPlannerLookup(characterId, locationId) {
  const locations = await prisma.characterLocation.findMany({
    where: {
      deletedAt: null,
      OR: [{ characterId: null }, { characterId }],
    },
    include: {
      references: {
        orderBy: { sortOrder: "asc" },
        include: { media: { select: { uploadedAt: true, storageKey: true } } },
      },
    },
  });
  const location = locations.find((item) => item.id === locationId);
  if (!location) throw new Error("Location is not visible to the planner lookup");
  if (
    location.references.length !== 5 ||
    location.references.some(
      (reference) => !reference.media.uploadedAt || !reference.media.storageKey,
    )
  ) {
    throw new Error("Location references are incomplete or not uploaded");
  }
  console.log(
    `verified plannerLookup=visible uploadedReferences=${location.references.length}`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
