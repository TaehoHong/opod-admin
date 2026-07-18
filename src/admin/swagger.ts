import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation | unknown>>;
  tags?: OpenApiTag[];
};

type OpenApiOperation = {
  parameters?: unknown[];
  security?: Array<Record<string, string[]>>;
  tags?: string[];
};

type OpenApiTag = {
  name: string;
  description: string;
};

export const adminSwaggerTags: OpenApiTag[] = [
  { name: "인증", description: "관리자 로그인, 세션, 계정 API" },
  { name: "캐릭터", description: "캐릭터, 페르소나, 메모리, 게시 정책 API" },
  { name: "게시글", description: "피드 게시글, 댓글, 반응 API" },
  { name: "스토리", description: "스토리 관리 API" },
  { name: "미디어", description: "미디어 업로드와 조회 API" },
  { name: "크레딧", description: "크레딧 지급과 원장 API" },
  { name: "사용자", description: "사용자 조회 API" },
  { name: "이벤트", description: "사용자 이벤트 조회 API" },
  { name: "해시태그", description: "해시태그 선호도 API" },
  { name: "생성 작업", description: "이미지/영상 생성 job 큐와 워커 API" },
  { name: "초안", description: "콘텐츠 초안 기획, 생성, 승인 API" },
  { name: "로그", description: "캐릭터 액션 로그 API" },
  { name: "분석", description: "운영 분석 API" },
  { name: "결제", description: "결제와 정산 API" },
  { name: "모더레이션", description: "신고 처리 API" },
  { name: "설정", description: "생성 프로바이더 설정 API" },
];

const tagByPathSegment: Record<string, string> = {
  admin: "인증",
  characters: "캐릭터",
  posts: "게시글",
  stories: "스토리",
  media: "미디어",
  credits: "크레딧",
  users: "사용자",
  events: "이벤트",
  "hashtag-preferences": "해시태그",
  generation: "생성 작업",
  drafts: "초안",
  "character-action-logs": "로그",
  analytics: "분석",
  payments: "결제",
  moderation: "모더레이션",
  settings: "설정",
};

const tagOrder = adminSwaggerTags.map((tag) => tag.name);

export function setupAdminSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("OPOD Admin API")
    .setVersion("0.1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "관리자 로그인 응답의 accessToken을 입력합니다.",
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const openApiDocument = document as unknown as OpenApiDocument;
  addDomainTags(openApiDocument);
  addAdminOperationMetadata(openApiDocument);

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      docExpansion: "none",
      operationsSorter: "alpha",
      persistAuthorization: true,
      tagsSorter: sortAdminSwaggerTags,
    },
  });
}

export function tagForAdminPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  const segment = segments[0] === "api" ? segments[1] : segments[0];
  return segment ? tagByPathSegment[segment] : undefined;
}

export function sortAdminSwaggerTags(left: string, right: string) {
  const leftIndex = tagOrder.indexOf(left);
  const rightIndex = tagOrder.indexOf(right);

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }
  if (leftIndex === -1) {
    return 1;
  }
  if (rightIndex === -1) {
    return -1;
  }
  return leftIndex - rightIndex;
}

function addDomainTags(document: OpenApiDocument) {
  document.tags = adminSwaggerTags;
}

function addAdminOperationMetadata(document: OpenApiDocument) {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const tag = tagForAdminPath(path);

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isHttpMethod(method) || !isOperation(operation)) {
        continue;
      }

      if (tag) {
        operation.tags = [tag];
      }
      if (requiresAdminAuth(path, method)) {
        addAuth(operation);
      }
    }
  }
}

function requiresAdminAuth(path: string, method: string) {
  return !(path === "/api/admin/login" && method === "post");
}

function addAuth(operation: OpenApiOperation) {
  operation.security = [{ bearer: [] }];
  operation.parameters = [
    ...(operation.parameters ?? []).filter((parameter) => {
      const record = toRecord(parameter);
      return !(
        record.in === "header" &&
        String(record.name).toLowerCase() === "authorization"
      );
    }),
    {
      name: "Authorization",
      in: "header",
      required: true,
      description: "Admin JWT access token. Example: Bearer <accessToken>",
      schema: { type: "string", example: "Bearer eyJhbGciOi..." },
    },
  ];
}

function isHttpMethod(method: string) {
  return [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "trace",
  ].includes(method);
}

function isOperation(value: unknown): value is OpenApiOperation {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
