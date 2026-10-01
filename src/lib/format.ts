import type { ValueFormat } from "@/types/report";

const CURRENCY = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 2,
});

const CURRENCY_COMPACT = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  notation: "compact",
  maximumFractionDigits: 1,
});

const INTEGER = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });

/** Shown wherever a metric is null. Distinguishes "no data" from a real zero. */
export const EMPTY_VALUE = "-";

/** Shown for a dimension whose value is null, most often an affiliate post's creator. */
export const UNKNOWN_DIMENSION = "(ไม่ทราบ)";

export function formatValue(value: number | null | undefined, format: ValueFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY_VALUE;

  switch (format) {
    case "currency":
      return CURRENCY.format(value);
    case "integer":
      return INTEGER.format(value);
    // Rates arrive from TikTok already scaled to 0-100, so no extra multiply here.
    case "percent":
      return `${DECIMAL.format(value)}%`;
    case "ratio":
      return DECIMAL.format(value);
    case "decimal":
      return DECIMAL.format(value);
    case "text":
      return String(value);
  }
}

/** Short form for summary cards and chart axes, where full precision does not fit. */
export function formatCompact(value: number | null | undefined, format: ValueFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY_VALUE;

  switch (format) {
    case "currency":
      return Math.abs(value) >= 100_000 ? CURRENCY_COMPACT.format(value) : CURRENCY.format(value);
    case "integer":
      return Math.abs(value) >= 100_000 ? COMPACT.format(value) : INTEGER.format(value);
    default:
      return formatValue(value, format);
  }
}

/** A dimension cell, mapping null and empty string onto the same visible token. */
export function formatDimension(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return UNKNOWN_DIMENSION;
  return value;
}

/**
 * YYYY-MM-DD to a Thai short date, without going through Date, so a date string from the ad
 * account's timezone is never shifted by the browser's offset
 */
const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function formatDateLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match as unknown as [string, string, string, string];
  const monthLabel = THAI_MONTHS[Number(month) - 1] ?? month;
  return `${Number(day)} ${monthLabel} ${Number(year) + 543}`;
}

/** Date to YYYY-MM-DD using local calendar fields, never toISOString. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses YYYY-MM-DD into a local-midnight Date, the inverse of toIsoDate. */
export function fromIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match as unknown as [string, string, string, string];
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Today, shifted by whole days. Used for the date-range presets. */
export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toIsoDate(date);
}

/** "15h 59m 32s" to seconds */
const DURATION_PART = /(\d+(?:\.\d+)?)\s*([dhms])/gi;
const UNIT_SECONDS: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };

export function parseDurationLabel(raw: string | null | undefined): number | null {
  if (!raw) return null;

  let total = 0;
  let matched = false;
  for (const match of raw.matchAll(DURATION_PART)) {
    const amount = match[1];
    const unit = match[2];
    if (amount === undefined || unit === undefined) continue;
    const seconds = UNIT_SECONDS[unit.toLowerCase()];
    if (seconds === undefined) continue;
    total += Number(amount) * seconds;
    matched = true;
  }

  // Distinguishes "nothing parseable here" from a stream that genuinely ran 0 seconds.
  return matched ? Math.round(total) : null;
}

/** Seconds back to a label in TikTok's own shape */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY_VALUE;

  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);

  if (hours === 0 && minutes === 0) return `${whole % 60}s`;
  if (hours === 0) return `${minutes}m`;
  return `${hours.toLocaleString("th-TH")}h ${minutes}m`;
}
