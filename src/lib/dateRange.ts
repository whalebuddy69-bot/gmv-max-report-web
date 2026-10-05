import { fromIsoDate, toIsoDate } from "./format";

export interface ReportDateRange { from: string; to: string }

/** Strict calendar dates: never silently roll February 30 into March. */
export function parseCalendarDate(value: string): Date | null {
  const date = fromIsoDate(value);
  return date && toIsoDate(date) === value ? date : null;
}

export function dateRangeError(range: ReportDateRange, today: string): string | null {
  if (!range.from || !range.to) return "เลือกวันเริ่มต้นและวันสิ้นสุดให้ครบ";
  if (!parseCalendarDate(range.from) || !parseCalendarDate(range.to)) {
    return "วันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ YYYY-MM-DD (ค.ศ.)";
  }
  if (range.from > range.to) return "วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น";
  if (range.to > today) return "เลือกได้ถึงวันนี้เท่านั้น";
  return null;
}

/** Count calendar days inclusively, independent of daylight-saving transitions. */
export function inclusiveDayCount(range: ReportDateRange): number {
  const from = parseCalendarDate(range.from);
  const to = parseCalendarDate(range.to);
  if (!from || !to || range.from > range.to) return 0;
  const utcDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000) + 1;
}

/** A completed range starts afresh; a second click sets either endpoint. */
export function selectRangeDay(range: ReportDateRange, day: string): ReportDateRange {
  if (parseCalendarDate(range.from) && !range.to) {
    return day < range.from ? { from: day, to: range.from } : { from: range.from, to: day };
  }
  return { from: day, to: "" };
}

function shiftDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function trailingMonths(today: Date, months: number): ReportDateRange {
  // Inclusive rolling calendar months, clamped at month-end.
  const targetEnd = new Date(today.getFullYear(), today.getMonth() - months + 1, 0);
  const anniversary = new Date(targetEnd.getFullYear(), targetEnd.getMonth(), Math.min(today.getDate(), targetEnd.getDate()));
  return { from: toIsoDate(shiftDays(anniversary, 1)), to: toIsoDate(today) };
}

export function dateRangePresets(today: Date) {
  const isoToday = toIsoDate(today);
  const lastDays = (days: number) => ({ from: toIsoDate(shiftDays(today, 1 - days)), to: isoToday });
  return [
    { label: "วันนี้", ...lastDays(1) },
    { label: "เมื่อวาน", from: toIsoDate(shiftDays(today, -1)), to: toIsoDate(shiftDays(today, -1)) },
    { label: "7 วันล่าสุด", ...lastDays(7) },
    { label: "14 วันล่าสุด", ...lastDays(14) },
    { label: "30 วันล่าสุด", ...lastDays(30) },
    { label: "เดือนนี้", from: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoToday },
    { label: "เดือนที่แล้ว", from: toIsoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 0)) },
    ...[3, 6, 12].map((months) => ({ label: `${months} เดือนล่าสุด`, ...trailingMonths(today, months) })),
  ];
}
