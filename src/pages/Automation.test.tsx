import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { automationOverviewSchema, automationPerformanceSchema, type AutomationClient } from "@/api/automation";
import { bangkokDay, isFreshAutomationClient, isStalePerformance, performanceMatchesClient, toHourlyChart } from "@/lib/automation";
import { AccessStatus, BudgetMeter, ReadOnlyActions } from "./Automation";

const CHECKED = "2026-03-05T17:00:10.000Z";
const now = Date.parse(CHECKED);
const campaign = {
  campaignId: "test-campaign",
  campaignName: "Synthetic campaign",
  campaignStatus: "ACTIVE",
  dailyBudgetMinor: 100_000,
  spendMinor: null,
  targetRoi: 6,
  currency: "THB",
} as const;
const client: AutomationClient = {
  clientId: "test-client",
  displayName: "Synthetic client",
  advertiserId: "test-advertiser",
  tiktokAccountId: "test-tiktok",
  access: "verified",
  observedAt: "2026-03-05T17:00:00.000Z",
  reportingDate: "2026-03-06",
  campaign,
  capMinor: null,
  actions: { start: false, pause: false, increaseBudget: false, decreaseBudget: false, auto: false },
};
const series = [
  { hour: "10:00", spendMinor: null, gmvMinor: 0, orders: 0, roi: null, liveViews: null },
  { hour: "08:00", spendMinor: 1250, gmvMinor: null, orders: null, roi: null, liveViews: null },
  { hour: "11:00", spendMinor: 0, gmvMinor: null, orders: null, roi: null, liveViews: 0 },
];
const performance = automationPerformanceSchema.parse({
  schemaVersion: 1,
  checkedAt: CHECKED,
  clientId: client.clientId,
  campaignId: campaign.campaignId,
  reportingDate: client.reportingDate,
  granularity: "hour",
  state: "available",
  series,
});

describe("Automation frontend", () => {
  it("rejects a claimed write capability for the read-only route", () => {
    const overview = { schemaVersion: 1, checkedAt: CHECKED, coverage: "configured-creators-only", clients: [client] };
    expect(automationOverviewSchema.safeParse(overview).success).toBe(true);
    expect(automationOverviewSchema.safeParse({
      ...overview,
      clients: [{ ...client, actions: { ...client.actions, increaseBudget: true } }],
    }).success).toBe(false);
  });

  it("counts verified access only while recent and the reporting date matches Bangkok", () => {
    expect(bangkokDay(now)).toBe("2026-03-06");
    expect(isFreshAutomationClient(client, now)).toBe(true);
    expect(isFreshAutomationClient({ ...client, reportingDate: "2026-03-05" }, now)).toBe(false);
    expect(isFreshAutomationClient({ ...client, access: "unavailable" }, now)).toBe(false);
    expect(isFreshAutomationClient({ ...client, observedAt: "2026-03-05T16:56:00.000Z" }, now)).toBe(false);
    expect(renderToStaticMarkup(<AccessStatus client={{ ...client, observedAt: null }} now={now} />)).toContain("ข้อมูลเก่า");
    expect(renderToStaticMarkup(<AccessStatus client={{ ...client, access: "unavailable" }} now={now} />)).toContain("ยังยืนยันการเข้าถึงไม่ได้");
  });

  it("never shows a chart for an older campaign, another Creator, or another day", () => {
    expect(performanceMatchesClient(performance, client)).toBe(true);
    expect(performanceMatchesClient({ ...performance, campaignId: "old-campaign" }, client)).toBe(false);
    expect(performanceMatchesClient({ ...performance, clientId: "other-client" }, client)).toBe(false);
    expect(performanceMatchesClient({ ...performance, reportingDate: "2026-03-05" }, client)).toBe(false);
    expect(performanceMatchesClient(performance, { ...client, campaign: null })).toBe(false);
  });

  it("distinguishes provider observation time from a newly checked API response", () => {
    expect(performance.observedAt).toBeNull();
    expect(isStalePerformance({ ...performance, observedAt: "2026-03-05T16:53:00.000Z" }, now)).toBe(true);
    expect(isStalePerformance({ ...performance, observedAt: "2026-03-05T16:58:00.000Z" }, now)).toBe(false);
  });

  it("orders provider labels, converts satang, and preserves real zero vs unknown gaps", () => {
    expect(toHourlyChart(series, "spendMinor")).toEqual([
      { minute: 480, value: 12.5 },
      { minute: 540, value: null },
      { minute: 600, value: null },
      { minute: 660, value: 0 },
    ]);
    expect(toHourlyChart(series, "liveViews").at(-1)?.value).toBe(0);
    expect(automationPerformanceSchema.safeParse({ ...performance, series: [...series, series[0]] }).success).toBe(false);
  });

  it("shows missing spend as unknown and never claims a zero utilization", () => {
    const missing = renderToStaticMarkup(<BudgetMeter campaign={campaign} />);
    expect(missing).toContain("ยังยืนยันยอดใช้ไม่ได้");
    expect(missing).not.toContain('role="meter"');
    const over = renderToStaticMarkup(<BudgetMeter campaign={{ ...campaign, spendMinor: 120_000 }} />);
    expect(over).toContain("120% ของงบแคมเปญ");
    expect(over).toContain('aria-valuenow="100"');
  });

  it("renders all five planned actions visibly disabled with a reason", () => {
    const html = renderToStaticMarkup(<ReadOnlyActions />);
    expect(html.match(/disabled=""/g)).toHaveLength(5);
    expect(html).toContain("ปิด/พัก");
    expect(html).toContain("รุ่นนี้อ่านข้อมูลเท่านั้น");
    expect(html.match(/aria-describedby="automation-write-disabled"/g)).toHaveLength(5);
  });
});
