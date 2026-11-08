import type { UseQueryResult } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AutomationClient, AutomationPerformance, AutomationPoint } from "@/api/automation";
import { ApiError } from "@/api/client";
import { CreatorHistoricalPerformance, CreatorHistoricalPerformanceBody, summarizeReportedHours } from "./CreatorHistoricalPerformance";

const date = "2026-11-08";
const observedAt = "2026-11-08T01:00:00Z";
const client: AutomationClient = {
  clientId: "srihiw", advertiserId: "ads-1", tiktokAccountId: "tt-1", displayName: "Srihiw",
  access: "verified", reportingDate: date, observedAt, capMinor: null,
  campaign: { campaignId: "campaign-1", campaignName: "LIVE 1", campaignStatus: "ACTIVE", dailyBudgetMinor: 85_000,
    spendMinor: 1_000, targetRoi: 3, currency: "THB" },
  actions: { start: false, pause: false, increaseBudget: false, decreaseBudget: false, auto: false },
};
const point = (overrides: Partial<AutomationPoint> = {}): AutomationPoint => ({
  hour: "06:00", spendMinor: 1000, gmvMinor: 5000, orders: 1, roi: 5, liveViews: 20, ...overrides,
});
const series = [point({ hour: "08:00", spendMinor: 4000, gmvMinor: 8000, roi: 2, orders: null }), point()];
const payload: AutomationPerformance = {
  schemaVersion: 1, checkedAt: observedAt, observedAt, clientId: client.clientId, campaignId: client.campaign!.campaignId,
  reportingDate: date, granularity: "hour", state: "available", series,
};
const result = { isPending: false, isError: false, isFetching: false } as UseQueryResult<AutomationPerformance, Error>;

describe("Creator historical performance", () => {
  it("summarizes only returned hours and computes a spend-weighted ROI instead of averaging the ratios", () => {
    expect(summarizeReportedHours(series)).toEqual({ spendMinor: 5000, gmvMinor: 13_000, orders: null, roi: 2.6, liveViews: 40 });
    expect(summarizeReportedHours([point({ spendMinor: 0 }), point({ spendMinor: null })])).toMatchObject({ spendMinor: null, roi: null });
    expect(summarizeReportedHours([point({ spendMinor: 0, gmvMinor: 0, orders: 0 })])).toMatchObject({ spendMinor: 0, gmvMinor: 0, orders: 0, roi: null });
    expect(summarizeReportedHours([point({ spendMinor: Number.MAX_SAFE_INTEGER }), point()])).toMatchObject({ spendMinor: null, roi: null });
    expect(summarizeReportedHours([])).toMatchObject({ spendMinor: null, gmvMinor: null, roi: null });
  });

  it("shows only the returned hourly rows, in chronological order, with explicit missing metrics", () => {
    const html = renderToStaticMarkup(<CreatorHistoricalPerformanceBody client={client} payload={payload} view="hourly" metric="orders" />);
    expect(html).toContain("รายงานรายชั่วโมง: ออเดอร์");
    expect(html.indexOf(">06:00</th>")).toBeLessThan(html.indexOf(">08:00</th>"));
    expect(html).not.toContain(">07:00</th>");
    expect(html).toContain("ไม่มีข้อมูล");
  });

  it("labels the daily view as a current-day subtotal and not a daily total", () => {
    const html = renderToStaticMarkup(<CreatorHistoricalPerformanceBody client={client} payload={payload} view="daily" metric="roi" />);
    expect(html).toContain("สรุปวันนี้ · เฉพาะชั่วโมงที่ได้รับ");
    expect(html).toContain("ไม่ใช่ยอดเต็มวัน");
    expect(html).toContain("2.60");
  });

  it.each([{ clientId: "other" }, { campaignId: "old-campaign" }, { reportingDate: "2026-11-07" }, { observedAt: null }] as const)(
    "refuses report data not verified for the same account, campaign, and day: %o", (overrides) => {
      const html = renderToStaticMarkup(<CreatorHistoricalPerformanceBody client={client} payload={{ ...payload, ...overrides }} view="hourly" metric="spendMinor" />);
      expect(html).toContain("ยังไม่มีรายงานที่ยืนยันได้สำหรับแคมเปญนี้");
      expect(html).not.toContain("<table");
    },
  );

  it("does not offer refresh or show cached numbers without access or after an authorization failure", () => {
    const denied = new ApiError("Forbidden", { code: "FORBIDDEN", status: 403 });
    for (const html of [
      renderToStaticMarkup(<CreatorHistoricalPerformance client={{ ...client, access: "unavailable" }} payload={payload} result={result} />),
      renderToStaticMarkup(<CreatorHistoricalPerformance client={client} payload={payload} result={{ ...result, isError: true, error: denied } as UseQueryResult<AutomationPerformance, Error>} />),
    ]) {
      expect(html).not.toContain("อัปเดตรายงาน");
      expect(html).not.toContain("<table");
      expect(html).toContain("ยังไม่รองรับการเลือกวันที่ย้อนหลัง");
    }
  });
});
