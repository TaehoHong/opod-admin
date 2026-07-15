import { errorMessage, isRecord, parsePositiveNumber } from "./value-utils";

describe("worker value utils", () => {
  it("normalizes thrown values", () => {
    expect(errorMessage(new Error("provider down"))).toBe("provider down");
    expect(errorMessage("plain failure")).toBe("plain failure");
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
