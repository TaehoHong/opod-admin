import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { DataPage } from "./DataPage";

describe("DataPage status feedback", () => {
  it("announces loading progress with a visible message", () => {
    render(
      <AppProviders>
        <DataPage title="게시글" isPending>
          결과
        </DataPage>
      </AppProviders>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("게시글 불러오는 중…");
  });

  it("announces an empty result", () => {
    render(
      <AppProviders>
        <DataPage title="게시글" isPending={false} isEmpty>
          결과
        </DataPage>
      </AppProviders>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "표시할 항목이 없습니다.",
    );
  });
});
