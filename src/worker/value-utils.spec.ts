import { errorMessage, isRecord, parsePositiveNumber } from "./value-utils";

describe("worker value utils", () => {
  it("normalizes thrown values", () => {
    expect(errorMessage(new Error("provider down"))).toBe("provider down");
    expect(errorMessage("plain failure")).toBe("plain failure");
  });

  it("unwraps fetch failure causes so the real reason is visible", () => {
    // undici 스타일: fetch failed ← AggregateError[ECONNREFUSED]
    const connect = new AggregateError(
      [new Error("connect ECONNREFUSED 1.2.3.4:443")],
      "aggregate",
    );
    const fetchFailed = new Error("fetch failed");
    (fetchFailed as Error & { cause?: unknown }).cause = connect;
    expect(errorMessage(fetchFailed)).toBe(
      "fetch failed ← connect ECONNREFUSED 1.2.3.4:443",
    );

    const dnsFailed = new Error("fetch failed");
    (dnsFailed as Error & { cause?: unknown }).cause = new Error(
      "getaddrinfo ENOTFOUND api.openai.com",
    );
    expect(errorMessage(dnsFailed)).toBe(
      "fetch failed ← getaddrinfo ENOTFOUND api.openai.com",
    );
  });

  it("parses only finite positive numbers", () => {
    expect(parsePositiveNumber(" 2.5 ")).toBe(2.5);
    expect(parsePositiveNumber("0")).toBeUndefined();
    expect(parsePositiveNumber("not-a-number")).toBeUndefined();
    expect(parsePositiveNumber(undefined)).toBeUndefined();
  });

  it("accepts records but not arrays or null", () => {
    expect(isRecord({ key: "value" })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});
