import { describe, expect, it } from "vitest";
import {
  deliveryStatusExportValue, deliveryStatusHeader, deliveryStatusTooltip,
  formatStatusCheckedAt, hasStatusProvenance, statusReportDateSchema, statusTimestampSchema,
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
    expect(deliveryStatusExportValue({ ...verified, creativeDeliveryStatus: null })).toBe("(ไม่ทราบ)");
    expect(deliveryStatusExportValue({ creativeDeliveryStatus: "DELIVERING" })).toBe("DELIVERING (latest status not verified)");
    expect(deliveryStatusTooltip(verified)).toContain("Source report date: 2026-10-05");
    expect(deliveryStatusTooltip(verified)).toContain("ไม่ใช่เวลาที่ TikTok เปลี่ยนสถานะ");
    expect(deliveryStatusTooltip({ creativeDeliveryStatus: "LEARNING" })).toContain("latest status not verified");
  });
});
