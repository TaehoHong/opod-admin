import { errorMessage } from "./value-utils";

export type PipelineFailure = {
  code: string;
  stage: string;
  problem: string;
  cause: string;
  nextAction: string;
  technicalDetail: string;
  occurredAt: string;
  retryable: boolean;
};

export function pipelineFailure(
  error: unknown,
  stage: unknown,
  occurredAt = new Date(),
): PipelineFailure {
  const detail = errorMessage(error).slice(0, 500);
  const normalized = detail.toLowerCase();
  const stageName = typeof stage === "string" ? stage : "unknown";
  const base = {
    stage: stageName,
    technicalDetail: detail,
    occurredAt: occurredAt.toISOString(),
    retryable: true,
  };

  if (normalized.includes("timeout") || normalized.includes("aborted")) {
    return {
      ...base,
      code: "agent_timeout",
      problem: "Agent 응답 시간이 초과되었습니다.",
      cause: "설정된 제한 시간 안에 AI 제공자의 응답이 끝나지 않았습니다.",
      nextAction:
        "제공자 상태와 네트워크를 확인한 뒤 현재 단계를 다시 실행하세요.",
    };
  }
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("enotfound") ||
    normalized.includes("econnrefused") ||
    normalized.includes("tls")
  ) {
    return {
      ...base,
      code: "provider_connection_failed",
      problem: "AI 제공자에 연결하지 못했습니다.",
      cause: "DNS, 네트워크 또는 TLS 연결 과정에서 요청이 실패했습니다.",
      nextAction:
        "AI 제공자 URL과 네트워크 연결을 확인한 뒤 현재 단계를 다시 실행하세요.",
    };
  }
  if (normalized.includes("structured agent failed (")) {
    const status = detail.match(/structured agent failed \((\d+)\)/)?.[1];
    return {
      ...base,
      code: "provider_http_error",
      problem: "AI 제공자가 요청을 거부했습니다.",
      cause: status
        ? `AI 제공자가 HTTP ${status} 오류를 반환했습니다.`
        : "AI 제공자가 오류 응답을 반환했습니다.",
      nextAction:
        "접힌 기술 상세에서 제공자 응답을 확인하고 설정 또는 입력을 수정한 뒤 다시 실행하세요.",
    };
  }
  if (
    normalized.includes("invalid json") ||
    normalized.includes("no content") ||
    normalized.includes("no union result") ||
    normalized.includes(" is invalid")
  ) {
    return {
      ...base,
      code: "invalid_agent_response",
      problem: "AI 응답을 게시글 산출물로 해석하지 못했습니다.",
      cause: "AI 응답이 현재 단계의 구조화 출력 계약과 일치하지 않았습니다.",
      nextAction:
        "기술 상세와 LLM 로그를 확인한 뒤 현재 단계를 다시 실행하세요.",
    };
  }
  if (normalized.includes("cas lost")) {
    return {
      ...base,
      code: "concurrent_update",
      problem: "동시에 변경된 게시글에 결과를 저장하지 못했습니다.",
      cause:
        "Agent 실행 중 다른 요청이 같은 단계나 산출물 revision을 먼저 변경했습니다.",
      nextAction:
        "화면을 새로고침해 최신 상태를 확인한 뒤 필요한 경우 현재 단계를 다시 실행하세요.",
    };
  }
  if (
    normalized.includes("requires a ready") ||
    normalized.includes("missing")
  ) {
    return {
      ...base,
      code: "stage_dependency_missing",
      problem: "현재 단계에 필요한 이전 산출물이 없습니다.",
      cause:
        "이전 단계의 결과 또는 필수 입력을 찾지 못해 실행을 계속할 수 없습니다.",
      nextAction:
        "이전 단계 산출물과 필수 입력을 확인한 뒤 현재 단계를 다시 실행하세요.",
    };
  }
  return {
    ...base,
    code: "stage_execution_failed",
    problem: "게시글 생성 단계 실행에 실패했습니다.",
    cause:
      "예상하지 못한 실행 오류가 발생했습니다. 정확한 원문은 기술 상세에 보존했습니다.",
    nextAction:
      "기술 상세와 서버 로그를 확인한 뒤 현재 단계를 다시 실행하세요.",
  };
}
