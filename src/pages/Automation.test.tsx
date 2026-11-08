import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { automationOverviewSchema, automationPerformancePath, automationPerformanceSchema, PILOT_BUDGET_CLIENT_ID, type AutomationClient } from "@/api/automation";
import { bangkokDay, creatorRowPerformance, isFreshAutomationClient, isStalePerformance, performanceMatchesClient, summarizeCreatorPerformance, toHourlyChart } from "@/lib/automation";
import { CreatorOverviewDashboard } from "@/components/automation/CreatorOverviewDashboard";

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
    expect(automationOverviewSchema.safeParse({ ...overview, clients: [client, client] }).success).toBe(false);
  });

  it("creates safe account-scoped performance paths only", () => {
    expect(automationPerformancePath("test-client")).toBe("/automation/performance/test-client");
    expect(automationPerformancePath("punpan_020")).toBe("/automation/performance/punpan_020");
    for (const value of ["a", "Upper", "00bad", "../other", "good?key=bad", "good/bad", "good%2Fbad", "a".repeat(41)]) {
      expect(() => automationPerformancePath(value)).toThrow("รหัส Creator ไม่ถูกต้อง");
    }
  });

  it("counts verified access only while recent and the reporting date matches Bangkok", () => {
    expect(bangkokDay(now)).toBe("2026-03-06");
    expect(isFreshAutomationClient(client, now)).toBe(true);
    expect(isFreshAutomationClient({ ...client, reportingDate: "2026-03-05" }, now)).toBe(false);
    expect(isFreshAutomationClient({ ...client, access: "unavailable" }, now)).toBe(false);
    expect(isFreshAutomationClient({ ...client, observedAt: "2026-03-05T16:56:00.000Z" }, now)).toBe(false);
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
    const valid = { ...performance, observedAt: CHECKED };
    expect(creatorRowPerformance(valid, client, now)).toBe(valid);
    expect(creatorRowPerformance(valid, { ...client, access: "unavailable" }, now)).toBeNull();
    expect(creatorRowPerformance({ ...valid, campaignId: "old-campaign" }, client, now)).toBeNull();
    expect(creatorRowPerformance(performance, client, now)).toBeNull();
    expect(creatorRowPerformance({ ...valid, observedAt: "2026-03-05T16:53:00.000Z" }, client, now)).toBeNull();
  });

  it("totals returned hours without inventing zeros or averaging hourly ROI", () => {
    const valid = [
      { hour: "08:00", spendMinor: 2500, gmvMinor: 5000, orders: 2, roi: 2, liveViews: 0 },
      { hour: "10:00", spendMinor: 7500, gmvMinor: 30000, orders: 3, roi: 4, liveViews: 10 },
    ];
    expect(summarizeCreatorPerformance(valid)).toEqual({ gmvMinor: 35000, orders: 5, roi: 3.5, liveViews: 10 });
    expect(summarizeCreatorPerformance(series)).toEqual({ gmvMinor: null, orders: null, roi: null, liveViews: null });
    expect(summarizeCreatorPerformance([{ ...valid[0]!, spendMinor: 0, gmvMinor: 0 }])).toEqual({ gmvMinor: 0, orders: 2, roi: null, liveViews: 0 });
    expect(summarizeCreatorPerformance([])).toEqual({ gmvMinor: null, orders: null, roi: null, liveViews: null });
  });

  const ppan = { ...client, clientId: PILOT_BUDGET_CLIENT_ID, displayName: "Ppan fixture" };
  const srihiw = { ...client, clientId: "srihiw", displayName: "Srihiw fixture" };
  const pending: AutomationClient = {
    ...client, clientId: "other-creator", displayName: "Secondary fixture", access: "unavailable",
    accessReason: "needs-authorization", campaign: null, reportingDate: null, observedAt: null, tiktokAccountIdVerified: false,
  };
  const overview = (clients = [ppan, srihiw, pending]) => automationOverviewSchema.parse({
    schemaVersion: 1, checkedAt: CHECKED, coverage: "configured-creators-only", clients,
  });
  it("starts at one multi-Creator overview with no write controls opened", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CreatorOverviewDashboard data={overview()} userId={17} now={now}
          onSync={async () => null} onRefreshCampaign={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain("บัญชีทั้งหมด");
    expect(html).toContain("เลือกหลายบัญชี Creator");
    expect(html).toContain("สรุป Performance ของบัญชีที่เลือก");
    expect(html).toContain("Ppan fixture");
    expect(html).toContain("Srihiw fixture");
    expect(html).toContain("Secondary fixture");
    expect(html).toContain("รายงานตามช่วงเวลา");
    expect(html).not.toContain("ปรับงบจากเว็บ");
    expect(html).not.toContain('aria-current="step"');
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

});
