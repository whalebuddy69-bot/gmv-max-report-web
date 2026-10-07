import { z } from "zod";
import type { ReportRow } from "@/types/report";
import { formatDimension } from "./format";

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
  if (!hasStatusProvenance(row)) {
    return "Delivery status — ยังยืนยันสถานะล่าสุดไม่ได้ (latest status not verified): API ยังไม่มีข้อมูลเวลาตรวจสอบและวันที่ต้นทางครบถ้วน";
  }
  return `Latest known delivery status — สถานะล่าสุดที่ระบบมี แยกจากช่วงวันที่ของยอดขาย\nStatus checked at: ${formatStatusCheckedAt(row.creativeDeliveryStatusCheckedAt)} (Asia/Bangkok)\nSource report date: ${row.creativeDeliveryStatusStatDate}\nเวลาที่ระบบซิงก์ข้อมูล ไม่ใช่เวลาที่ TikTok เปลี่ยนสถานะ และไม่ใช่ Exploration status`;
}

export function deliveryStatusExportValue(row: StatusRow): string {
  const status = formatDimension(row.creativeDeliveryStatus);
  return hasStatusProvenance(row) ? status : `${status} (latest status not verified)`;
}
