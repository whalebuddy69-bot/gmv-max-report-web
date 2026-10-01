import { describe, expect, it } from "vitest";
import { EMPTY_VALUE, formatDurationSeconds, parseDurationLabel } from "./format";

describe("parseDurationLabel", () => {
  it("reads hours, minutes and seconds together", () => {
    expect(parseDurationLabel("15h 59m 32s")).toBe(15 * 3600 + 59 * 60 + 32);
    expect(parseDurationLabel("14h 1m")).toBe(50_460);
  });

  it("accepts labels that omit the parts that are zero", () => {
    // TikTok drops empty units rather than padding them, so none of these is a fixed shape to
    // match against
    expect(parseDurationLabel("3h 12m")).toBe(11_520);
    expect(parseDurationLabel("45m")).toBe(2_700);
    expect(parseDurationLabel("32s")).toBe(32);
    expect(parseDurationLabel("2h")).toBe(7_200);
  });

  it("handles a stream long enough to be reported in days", () => {
    expect(parseDurationLabel("1d 2h 30m")).toBe(86_400 + 7_200 + 1_800);
  });

  it("tolerates spacing and case", () => {
    expect(parseDurationLabel("15H59M32S")).toBe(15 * 3600 + 59 * 60 + 32);
    expect(parseDurationLabel("  3h   12m  ")).toBe(11_520);
  });

  it("returns null rather than 0 when there is nothing to read", () => {
    // A genuine zero-second stream and an unreadable label must not look the same: one is a
    // number to sort on, the other belongs at the bottom of the list
    expect(parseDurationLabel(null)).toBeNull();
    expect(parseDurationLabel(undefined)).toBeNull();
    expect(parseDurationLabel("")).toBeNull();
    expect(parseDurationLabel("ไม่ทราบ")).toBeNull();
    expect(parseDurationLabel("0s")).toBe(0);
  });

  it("does not mistake a date for a duration", () => {
    // The parser runs over whatever the field holds
    expect(parseDurationLabel("2026-09-01")).toBeNull();
    expect(parseDurationLabel("2026-09-01 19:00:00")).toBeNull();
  });

  it("is not affected by the regex's lastIndex across calls", () => {
    // The pattern is module-level and global
    expect(parseDurationLabel("15h 59m 32s")).toBe(57_572);
    expect(parseDurationLabel("15h 59m 32s")).toBe(57_572);
    expect(parseDurationLabel("45m")).toBe(2_700);
  });
});

describe("formatDurationSeconds", () => {
  it("reads back what parseDurationLabel read in", () => {
    for (const label of ["15h 59m", "3h 12m", "45m", "2h 0m"]) {
      const seconds = parseDurationLabel(label);
      expect(seconds).not.toBeNull();
      expect(formatDurationSeconds(seconds)).toBe(label.replace(/^(\d+h) 0m$/, "$1 0m"));
    }
  });

  it("keeps hours rather than rolling into days", () => {
    // A month across a dozen shops is hundreds of hours
    expect(formatDurationSeconds(412 * 3600 + 30 * 60)).toBe("412h 30m");
    expect(formatDurationSeconds(1_000 * 3600)).toBe("1,000h 0m");
  });

  it("drops empty leading units instead of padding them", () => {
    expect(formatDurationSeconds(45 * 60)).toBe("45m");
    expect(formatDurationSeconds(32)).toBe("32s");
  });

  it("shows nothing for a total there is no data for", () => {
    // Distinct from a genuine zero, which is a fact the reader can act on.
    expect(formatDurationSeconds(null)).toBe(EMPTY_VALUE);
    expect(formatDurationSeconds(undefined)).toBe(EMPTY_VALUE);
  });
});
