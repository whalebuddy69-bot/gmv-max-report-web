import { describe, expect, it } from "vitest";
import { dateRangeError, dateRangePresets, inclusiveDayCount, parseCalendarDate, selectRangeDay } from "./dateRange";
import { toIsoDate } from "./format";

describe("calendar date validation", () => {
  it.each(["", "2026-2-01", "2026-02-30", "2026-02-29", "2026-13-01", "2026-01-00", "2026-04-31", "2569-10-05x"])("rejects %s without rolling it over", (value) => {
    expect(parseCalendarDate(value)).toBeNull();
  });
  it.each(["2024-02-29", "2026-10-05", "2026-12-31"])("preserves local date %s", (value) => {
    expect(toIsoDate(parseCalendarDate(value)!)).toBe(value);
  });
  it("allows a single day; rejects incomplete, reversed, impossible or future dates", () => {
    const today = "2026-10-05";
    expect(dateRangeError({ from: today, to: today }, today)).toBeNull();
    expect(dateRangeError({ from: today, to: "" }, today)).not.toBeNull();
    expect(dateRangeError({ from: today, to: "2026-10-01" }, today)).not.toBeNull();
    expect(dateRangeError({ from: "2026-02-30", to: today }, today)).not.toBeNull();
    expect(dateRangeError({ from: today, to: "2026-10-06" }, today)).not.toBeNull();
  });
});

describe("inclusive day counts", () => {
  it.each([
    ["2026-10-01", "2026-10-10", 10], ["2026-10-05", "2026-10-05", 1],
    ["2024-02-28", "2024-03-01", 3], ["2025-12-31", "2026-01-01", 2],
    ["2026-03-07", "2026-03-10", 4], ["2026-10-31", "2026-11-02", 3],
    ["2026-10-05", "2026-10-01", 0], ["2026-02-30", "2026-03-01", 0],
  ])("counts %s through %s as %s days", (from, to, count) => {
    expect(inclusiveDayCount({ from, to })).toBe(count);
  });
});

describe("two-click range selection", () => {
  it("starts a new draft without keeping an old endpoint", () => {
    expect(selectRangeDay({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-01"))
      .toEqual({ from: "2026-10-01", to: "" });
  });
  it.each([
    ["2026-10-05", { from: "2026-10-01", to: "2026-10-05" }],
    ["2026-09-29", { from: "2026-09-29", to: "2026-10-01" }],
    ["2026-10-01", { from: "2026-10-01", to: "2026-10-01" }],
  ])("completes using %s, including reverse and same-day clicks", (day, expected) => {
    expect(selectRangeDay({ from: "2026-10-01", to: "" }, day)).toEqual(expected);
  });
});

describe("date shortcuts", () => {
  const presets = dateRangePresets(new Date(2026, 9, 5));
  it.each([
    ["วันนี้", "2026-10-05", "2026-10-05"], ["เมื่อวาน", "2026-10-04", "2026-10-04"],
    ["7 วันล่าสุด", "2026-09-29", "2026-10-05"], ["14 วันล่าสุด", "2026-09-22", "2026-10-05"],
    ["30 วันล่าสุด", "2026-09-06", "2026-10-05"], ["เดือนนี้", "2026-10-01", "2026-10-05"],
    ["เดือนที่แล้ว", "2026-09-01", "2026-09-30"], ["3 เดือนล่าสุด", "2026-07-06", "2026-10-05"],
    ["6 เดือนล่าสุด", "2026-04-06", "2026-10-05"], ["12 เดือนล่าสุด", "2025-10-06", "2026-10-05"],
  ])("%s uses inclusive endpoints", (label, from, to) => {
    expect(presets.find((preset) => preset.label === label)).toEqual({ label, from, to });
  });
  it("handles year boundaries and leap-month ends without mutating today", () => {
    const today = new Date(2024, 0, 1);
    const january = dateRangePresets(today);
    expect(january.find((p) => p.label === "เมื่อวาน")?.from).toBe("2023-12-31");
    expect(january.find((p) => p.label === "เดือนที่แล้ว"))
      .toEqual({ label: "เดือนที่แล้ว", from: "2023-12-01", to: "2023-12-31" });
    expect(toIsoDate(today)).toBe("2024-01-01");
    expect(dateRangePresets(new Date(2024, 4, 31)).find((p) => p.label === "3 เดือนล่าสุด")?.from).toBe("2024-03-01");
    expect(dateRangePresets(new Date(2024, 1, 29)).find((p) => p.label === "12 เดือนล่าสุด")?.from).toBe("2023-03-01");
  });
});
