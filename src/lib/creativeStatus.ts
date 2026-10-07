import { z } from "zod";
import type { ReportRow } from "@/types/report";

/** TikTok's delivery states, not Exploration / Outstanding quality classifications. */
export const DELIVERY_STATUS_CATALOG = [
  { value: "IN_QUEUE", label: "In queue", meaning: "อยู่ในคิว", badgeClassName: "border-sky-200 bg-sky-50 text-sky-800" },
  { value: "LEARNING", label: "Learning", meaning: "กำลังเรียนรู้", badgeClassName: "border-violet-200 bg-violet-50 text-violet-800" },
  { value: "DELIVERING", label: "Delivering", meaning: "กำลังนำส่งโฆษณา", badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  // NOT_DELIVERYING is the API's spelling. Never silently replace the raw code.
  { value: "NOT_DELIVERYING", label: "Not delivering", meaning: "ไม่ได้กำลังนำส่งโฆษณา", badgeClassName: "border-slate-200 bg-slate-50 text-slate-700" },
  { value: "AUTHORIZATION_NEEDED", label: "Authorization needed", meaning: "ต้องได้รับสิทธิ์ใช้ชิ้นงาน", badgeClassName: "border-amber-200 bg-amber-50 text-amber-900" },
  { value: "EXCLUDED", label: "Excluded", meaning: "ถูกยกเว้นจากการใช้งาน", badgeClassName: "border-stone-200 bg-stone-50 text-stone-700" },
  { value: "UNAVAILABLE", label: "Unavailable", meaning: "ไม่พร้อมใช้งาน", badgeClassName: "border-orange-200 bg-orange-50 text-orange-900" },
  { value: "REJECTED", label: "Rejected", meaning: "ไม่ผ่านการตรวจสอบ", badgeClassName: "border-rose-200 bg-rose-50 text-rose-800" },
  { value: "NOT_ACTIVE", label: "Not active", meaning: "วิดีโอโพสต์เกิน 30 วัน และไม่มีรายได้รวมใน 30 วันที่ผ่านมา", badgeClassName: "border-zinc-200 bg-zinc-50 text-zinc-700" },
] as const;

export type KnownDeliveryStatus = typeof DELIVERY_STATUS_CATALOG[number]["value"];
export type DeliveryStatusFilter = KnownDeliveryStatus | "UNKNOWN" | "OTHER";

const FALLBACK_BADGE_CLASS = "border-border bg-muted/40 text-muted-foreground";

export function getDeliveryStatusPresentation(value: string | null | undefined): {
  label: string; meaning: string; badgeClassName: string;
} {
  const known = DELIVERY_STATUS_CATALOG.find((status) => status.value === value);
  if (known) return known;
  const unknown = value == null || ["", "-", "0", "-1"].includes(value.trim());
  return !unknown
    ? { label: value, meaning: "สถานะอื่นจาก API — ยังไม่มีคำอธิบายในระบบ", badgeClassName: FALLBACK_BADGE_CLASS }
    : { label: "Unknown", meaning: "API ยังไม่ส่งสถานะที่ทราบได้", badgeClassName: FALLBACK_BADGE_CLASS };
}

/** Counts are over the whole server-side scope, never computed from a table page. */
export function deliveryStatusFilterOptions(counts: Record<string, number> | null) {
  const definitions = [
    ...DELIVERY_STATUS_CATALOG,
    { value: "UNKNOWN" as const, label: "Unknown", meaning: "ยังไม่ทราบสถานะ" },
    { value: "OTHER" as const, label: "Other", meaning: "สถานะอื่นที่ API เพิ่มมา" },
  ];
  return definitions.map((status) => ({
    value: status.value,
    label: status.label,
    meaning: status.meaning,
    count: counts === null ? null : counts[status.value] ?? 0,
  }));
}

// Provenance is optional during rollout. Bad or missing provenance must never make an
// old delivery status appear verified, or prevent the rest of the report from loading.
export const statusTimestampSchema = z.string().datetime({ offset: true }).nullish().catch(null)
  .transform((value): string | null => value ?? null);
export const statusReportDateSchema = z.string().date().nullish().catch(null)
  .transform((value): string | null => value ?? null);

type StatusRow = Pick<ReportRow,
  "creativeDeliveryStatus" | "creativeDeliveryStatusCheckedAt" | "creativeDeliveryStatusStatDate">;

const BANGKOK_TIME = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function formatStatusCheckedAt(value: string | null | undefined): string | null {
  const valid = statusTimestampSchema.parse(value);
  if (!valid) return null;
  const instant = new Date(valid);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(BANGKOK_TIME.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} +07:00`;
}

export function hasStatusProvenance(row: StatusRow): boolean {
  return formatStatusCheckedAt(row.creativeDeliveryStatusCheckedAt) !== null
    && statusReportDateSchema.parse(row.creativeDeliveryStatusStatDate) !== null;
}

export function deliveryStatusHeader(rows: readonly StatusRow[]): string {
  return rows.length > 0 && rows.every(hasStatusProvenance)
    ? "Latest known delivery status" : "Delivery status";
}

export function deliveryStatusTooltip(row: StatusRow): string {
  const presentation = getDeliveryStatusPresentation(row.creativeDeliveryStatus);
  const meaning = `${presentation.label} — ${presentation.meaning}${row.creativeDeliveryStatus ? ` (${row.creativeDeliveryStatus})` : ""}`;
  if (!hasStatusProvenance(row)) {
    return `${meaning}\nDelivery status — ยังยืนยันสถานะล่าสุดไม่ได้ (latest status not verified): API ยังไม่มีข้อมูลเวลาตรวจสอบและวันที่ต้นทางครบถ้วน\nไม่ใช่ Exploration status`;
  }
  return `${meaning}\nLatest known delivery status — สถานะล่าสุดที่ระบบมี แยกจากช่วงวันที่ของยอดขาย\nStatus checked at: ${formatStatusCheckedAt(row.creativeDeliveryStatusCheckedAt)} (Asia/Bangkok)\nSource report date: ${row.creativeDeliveryStatusStatDate}\nเวลาที่ระบบซิงก์ข้อมูล ไม่ใช่เวลาที่ TikTok เปลี่ยนสถานะ และไม่ใช่ Exploration status`;
}

export function deliveryStatusExportValue(row: StatusRow): string | null {
  // Keep codes machine-readable. Freshness is represented by the adjacent timestamp
  // and source-date fields; the header only says "latest" when provenance is complete.
  return row.creativeDeliveryStatus ?? null;
}
