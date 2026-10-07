import { describe, expect, it } from "vitest";
import {
  deliveryStatusExportValue, deliveryStatusHeader, deliveryStatusTooltip,
  formatStatusCheckedAt, hasStatusProvenance, statusReportDateSchema, statusTimestampSchema,
  DELIVERY_STATUS_CATALOG, deliveryStatusFilterOptions, getDeliveryStatusPresentation,
} from "./creativeStatus";

const verified = {
  creativeDeliveryStatus: "LEARNING",
  creativeDeliveryStatusCheckedAt: "2026-10-06T19:20:30.123Z",
  creativeDeliveryStatusStatDate: "2026-10-05",
};

describe("creative status provenance", () => {
  it("formats Gregorian Bangkok time with its offset, including next-day rollover", () => {
    expect(formatStatusCheckedAt(verified.creativeDeliveryStatusCheckedAt)).toBe("2026-10-07 02:20:30 +07:00");
    expect(formatStatusCheckedAt("2026-10-07T02:20:30+07:00")).toBe("2026-10-07 02:20:30 +07:00");
    expect(formatStatusCheckedAt("2026-12-31T17:00:00Z")).toBe("2027-01-01 00:00:00 +07:00");
  });

  it.each([null, undefined, "", "bad-date", "2026-10-07", "2026-10-07T12:00:00", "2026-02-30T00:00:00Z"])(
    "treats an absent, invalid, or timezone-less checked-at value as unknown: %s", (value) => {
      expect(statusTimestampSchema.parse(value)).toBeNull();
      expect(formatStatusCheckedAt(value)).toBeNull();
    },
  );

  it("validates the source date without converting its timezone", () => {
    expect(statusReportDateSchema.parse("2026-10-05")).toBe("2026-10-05");
    expect(statusReportDateSchema.parse("2026-02-30")).toBeNull();
    expect(statusReportDateSchema.parse("2026-10-05T00:00:00Z")).toBeNull();
    expect(statusReportDateSchema.parse(undefined)).toBeNull();
  });

  it("only labels a whole table/export latest when every row has provenance", () => {
    expect(hasStatusProvenance(verified)).toBe(true);
    expect(deliveryStatusHeader([verified])).toBe("Latest known delivery status");
    expect(deliveryStatusHeader([])).toBe("Delivery status");
    expect(deliveryStatusHeader([verified, { creativeDeliveryStatus: "DELIVERING" }])).toBe("Delivery status");
    expect(hasStatusProvenance({ ...verified, creativeDeliveryStatusStatDate: null })).toBe(false);
  });

  it("does not infer an exploration state or replace the latest null status", () => {
    expect(deliveryStatusExportValue(verified)).toBe("LEARNING");
    expect(deliveryStatusExportValue({ ...verified, creativeDeliveryStatus: null })).toBeNull();
    expect(deliveryStatusExportValue({ creativeDeliveryStatus: "DELIVERING" })).toBe("DELIVERING");
    expect(deliveryStatusTooltip(verified)).toContain("Source report date: 2026-10-05");
    expect(deliveryStatusTooltip(verified)).toContain("ไม่ใช่เวลาที่ TikTok เปลี่ยนสถานะ");
    expect(deliveryStatusTooltip({ creativeDeliveryStatus: "LEARNING" })).toContain("latest status not verified");
  });
});

describe("delivery status catalog", () => {
  it("covers exactly the nine API codes without fixing the API's spelling or inventing quality states", () => {
    expect(DELIVERY_STATUS_CATALOG.map((entry) => entry.value)).toEqual([
      "IN_QUEUE", "LEARNING", "DELIVERING", "NOT_DELIVERYING", "AUTHORIZATION_NEEDED",
      "EXCLUDED", "UNAVAILABLE", "REJECTED", "NOT_ACTIVE",
    ]);
    expect(DELIVERY_STATUS_CATALOG.every((entry) => entry.label && entry.meaning && entry.badgeClassName)).toBe(true);
    expect(getDeliveryStatusPresentation("DELIVERING").label).toBe("Delivering");
    expect(getDeliveryStatusPresentation("NOT_DELIVERYING").label).toBe("Not delivering");
    expect(getDeliveryStatusPresentation("NOT_ACTIVE").meaning).toBe("วิดีโอโพสต์เกิน 30 วัน และไม่มีรายได้รวมใน 30 วันที่ผ่านมา");
  });

  it("keeps future codes visible and unknown statuses separate", () => {
    expect(getDeliveryStatusPresentation("NEW_TIKTOK_STATUS").label).toBe("NEW_TIKTOK_STATUS");
    expect(getDeliveryStatusPresentation("NEW_TIKTOK_STATUS").meaning).toContain("สถานะอื่น");
    for (const value of [null, undefined, "", "   ", "-", "0", "-1", " -1 ", " 0 "]) {
      expect(getDeliveryStatusPresentation(value).label).toBe("Unknown");
    }
    for (const value of ["-", "0", "-1", "  "]) {
      expect(deliveryStatusExportValue({ ...verified, creativeDeliveryStatus: value })).toBe(value);
    }
    expect(deliveryStatusExportValue({ ...verified, creativeDeliveryStatus: "NEW_TIKTOK_STATUS" })).toBe("NEW_TIKTOK_STATUS");
    expect(deliveryStatusTooltip({ ...verified, creativeDeliveryStatus: "AUTHORIZATION_NEEDED" })).toContain("ต้องได้รับสิทธิ์ใช้ชิ้นงาน");
  });

  it("always offers all known states plus Unknown and Other, including actual zero counts", () => {
    const options = deliveryStatusFilterOptions({ DELIVERING: 13, UNKNOWN: 2, OTHER: 1 });
    expect(options).toHaveLength(11);
    expect(options.find((option) => option.value === "DELIVERING")?.count).toBe(13);
    expect(options.find((option) => option.value === "REJECTED")?.count).toBe(0);
    expect(options.reduce((sum, option) => sum + (option.count ?? 0), 0)).toBe(16);
  });

  it("does not fabricate zero counts when the API has not returned status counts", () => {
    const options = deliveryStatusFilterOptions(null);
    expect(options).toHaveLength(11);
    expect(options.every((option) => option.count === null)).toBe(true);
  });
});
