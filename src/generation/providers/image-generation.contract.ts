import type { LlmLogContext } from "../../llm-logs/llm-log.service";

export type ImageGenerationRequest = {
  idempotencyKey: string;
  profile: "photoreal_identity_v1" | "photoreal_scene_v1";
  prompt: string;
  negativePrompt?: string;
  references: {
    id: string;
    role:
      "identity" | "background" | "outfit" | "pose" | "style" | "composition";
    primary?: boolean;
    url: string;
    description?: string;
  }[];
  candidateCount: number;
  // 프로바이더별 추가 파라미터 (visualProfile.providerConfig ← job.paramsJson
  // 순서로 병합됨). body에 마지막으로 병합되어 모델별 파라미터 이름 차이를
  // 덮어쓸 수 있다 (예: nano-banana의 aspect_ratio, seedream의 image_size).
  extraParams?: Record<string, unknown>;
  metadata?: Record<string, string>;
};

export type GeneratedImage = {
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
  sha256?: string;
  // SSE image 이벤트가 전달한 원본 바이트. 있으면 worker는 output URL을
  // 다시 다운로드하지 않고 이 값을 검증·영구 저장한다.
  dataBase64?: string;
  // opod-flux 복구 polling의 결과 endpoint에 Bearer가 설정된 경우, 결과를
  // 영구 저장하는 worker가 이 헤더로 별도 binary download를 수행한다.
  downloadHeaders?: Record<string, string>;
};

export type ImageGenerationProgress = {
  status: "queued" | "running" | "cancelling";
  phase?: "preparing" | "generating" | "quality_check" | "finalizing";
  stage?: string | null;
  progress?: number;
  updatedAt?: string;
};

export type GenerationPollResult =
  | { status: "pending"; progress?: ImageGenerationProgress }
  | { status: "completed"; images: GeneratedImage[]; costUsd?: number }
  // permanent: 입력 검증 실패(422 등) — 같은 입력으로 재시도해도 항상 실패한다.
  | { status: "failed"; errorMessage: string; permanent?: boolean };

// 워커가 제출 당시 snapshot(_shot.execution)에서 읽어 poll마다 전달한다.
// 재시작 뒤에도 같은 값이므로, 지원 비율로 생성한 뒤 요청 비율로 중앙 크롭하는
// provider(SpicyAPI)가 이 값을 기준으로 결과를 맞춘다. 다른 provider는 무시한다.
export type ImageGenerationPollOptions = {
  outputAspectRatio?: number | null;
};

// 제출과 결과 수령이 분리된 비동기 프로바이더 계약.
// submit 직후 requestId를 DB에 기록해야 재시작 후 poll로 이어받을 수 있다.
export type ImageGenerationProvider = {
  readonly name: string;
  setLogContext?(context: LlmLogContext): void;
  // sentPrompt는 프로바이더가 **실제로 보낸** prompt 문자열이다. 네거티브를
  // 본문에 합치는 모델이 있어 request.prompt와 다를 수 있고, 그 차이 때문에
  // 지금까지 DB·화면·연구 로그가 전송본을 못 봤다.
  submit(
    request: ImageGenerationRequest,
  ): Promise<{ requestId: string; sentPrompt: string }>;
  poll(
    requestId: string,
    options?: ImageGenerationPollOptions,
  ): Promise<GenerationPollResult>;
  // SSE처럼 provider가 push 진행률을 제공할 때만 구현한다. 구독 직후 현재
  // 최신값을 한 번 재생하므로 submit/DB 기록 사이에 온 이벤트도 유실되지 않는다.
  subscribeProgress?(
    requestId: string,
    listener: (progress: ImageGenerationProgress) => void,
  ): () => void;
  // 폴링 데드라인 초과 등으로 결과를 포기할 때의 베스트에포트 취소.
  // 큐에서 아직 시작 전인 요청만 실제로 취소되며, 실패는 무시한다.
  cancel?(requestId: string): Promise<void>;
  fail?(requestId: string, error: unknown): Promise<void>;
};

// 레퍼런스 유무에 따라 워커가 라우팅하는 프로바이더 쌍 (D4).
// - t2i: 레퍼런스가 없는 잡(비주얼 프로필 콜드스타트 테스트 생성) 담당.
// - edit: 레퍼런스 컨디셔닝 모델. nano-banana/edit·seedream v4 edit 등
//   image_urls가 "필수"인 모델 계열이므로 레퍼런스 없는 잡을 보내면 안 된다.
export type ImageGenerationProviders = {
  t2i: ImageGenerationProvider;
  edit: ImageGenerationProvider;
};

// 이미지 생성 설정 누락. 환경 구분 없이 실패시킨다 — 플레이스홀더 이미지를
// 성공으로 처리하면 개발용 결과가 운영 검수 큐에 들어간다
// (docs/02-development-rules.md "필수 설정 누락이나 잘못된 형식은 startup
// failure로 처리한다").
export class ImageGenerationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationConfigError";
  }
}

export class ImageGenerationRequestError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "ImageGenerationRequestError";
  }
}

// 프로바이더 구성 값 — 출처는 env 또는 admin_settings(DB)이며 이 계층은
// 출처를 모른다. 병합/우선순위는 GenerationSettingsService가 담당한다.
export type GenerationProviderSettings = {
  apiBaseUrl?: string;
  provider?: "fal" | "opod-flux" | "openai" | "spicyapi";
  openaiApiKey?: string;
  openaiImageModel?: string;
  spicyApiKey?: string;
  // SpicyAPI 모델 계열의 edit ID. t2i는 같은 계열의 text-to-image로 정한다.
  spicyImageModel?: string;
  qwenImageNegativePrompt?: string;
  apiKey?: string;
  editModel?: string;
  t2iModel?: string;
  opodFluxApiBaseUrl?: string;
  opodFluxApiKey?: string;
};
