import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { OperationErrorAlert, operationFailure } from "./OperationErrorAlert";

it("does not repeat the visible cause in technical details", () => {
  renderPage(
    <OperationErrorAlert
      failure={operationFailure(new Error("missing model"))}
    />,
  );
  expect(screen.getByText(/missing model/)).toBeInTheDocument();
  expect(screen.queryByText("기술 상세 보기")).toBeNull();
});
it("keeps distinct technical evidence collapsed behind a keyboard-focusable disclosure", async () => {
  const user = userEvent.setup();
  renderPage(
    <OperationErrorAlert
      failure={{
        problem: "처리 실패",
        cause: "모델 설정 필요",
        nextAction: "모델을 선택하세요.",
        technicalDetail: "provider trace",
      }}
    />,
  );
  const summary = screen.getByText("기술 상세 보기");
  await user.tab();
  expect(summary).toHaveFocus();
  const details = summary.closest("details");
  expect(details?.open).toBe(false);
  await user.click(summary);
  expect(details?.open).toBe(true);
  expect(screen.getByText("provider trace")).toBeVisible();
});

it("retains a distinct error code when the raw detail repeats the visible cause", async () => {
  const user = userEvent.setup();
  renderPage(
    <OperationErrorAlert
      failure={{
        problem: "실패",
        cause: "missing model",
        nextAction: "모델 설정",
        technicalDetail: "missing model",
        code: "configuration_missing",
      }}
    />,
  );
  await user.click(screen.getByText("기술 상세 보기"));
  expect(screen.getByText(/오류 코드 · configuration_missing/)).toBeVisible();
  expect(screen.getAllByText("missing model")).toHaveLength(1);
  await user.click(screen.getByText("기술 상세 보기"));
  expect(screen.getByText("기술 상세 보기").closest("details")?.open).toBe(
    false,
  );
});
