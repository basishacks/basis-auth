import { describe, expect, it } from "vitest";
import { cls, fmtDate, fmtDateTime, initials, relTime } from "./lib";

describe("initials", () => {
  it("derives two-letter initials from dotted and spaced names", () => {
    expect(initials("Jordan Smith")).toBe("JS");
    expect(initials("jane.doe@example.com", "jane.doe@example.com")).toBe("JD");
  });
  it("falls back to the email local part then a question mark", () => {
    expect(initials(null, "solo@example.test")).toBe("S");
    expect(initials(null, null)).toBe("?");
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  it("buckets seconds, minutes, hours, and days", () => {
    expect(relTime(new Date(now).toISOString(), now)).toBe("just now");
    expect(relTime(new Date(now - 90_000).toISOString(), now)).toBe("1 min ago");
    expect(relTime(new Date(now - 7_200_000).toISOString(), now)).toBe("2 h ago");
    expect(relTime(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe("3 d ago");
  });
  it("renders an em dash for missing values", () => {
    expect(relTime(null)).toBe("—");
    expect(relTime(undefined)).toBe("—");
  });
});

describe("formatting helpers", () => {
  it("formats dates and datetimes with graceful dashes", () => {
    expect(fmtDate("2026-02-03T00:00:00Z")).toMatch(/\d/);
    expect(fmtDateTime("2026-02-03T05:06:00Z")).toMatch(/2026/);
    expect(fmtDate(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
  });
});

describe("class joining", () => {
  it("skips falsy entries", () => {
    expect(cls("a", false && "b", undefined, "c")).toBe("a c");
  });
});
