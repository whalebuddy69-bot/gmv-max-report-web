import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID, type AutomationClient } from "@/api/automation";
import { fetchScopedCampaignControlStatus } from "@/api/automationCampaign";
import { automationCampaignsTodayPath, automationCampaignsTodaySchema, fetchAutomationCampaignsToday, type AutomationCampaignToday } from "@/api/automationCampaignsToday";
import { http } from "@/api/client";
import { allowedLifecycleIntent, campaignsTodayForClient, CreatorAccountCampaigns, CreatorCampaignBreakdownTable, endedTodayRow, visibleCampaignBreakdown } from "./CreatorCampaignDialog";

const instant = "2026-11-08T07:00:00Z";
const now = Date.parse(instant) + 500;
const client: AutomationClient = {
  clientId: PILOT_BUDGET_CLIENT_ID, advertiserId: "test-adv", tiktokAccountId: "test-tt", displayName: "Synthetic Ppan",
  access: "verified", observedAt: instant, reportingDate: "2026-11-08", campaign: null, capMinor: null,
  actions: { start: false, pause: false, increaseBudget: false, decreaseBudget: false, auto: false },
};
const active: AutomationCampaignToday = {
  campaignId: "12345678", campaignName: "Active today", operationStatus: "ENABLE", dailyBudgetMinor: 600_000,
  targetRoi: 4, spendMinor: 100_000, gmvMinor: 250_000, roi: 2.5, activityToday: true,
  scheduleStartAt: instant, scheduleEndAt: null,
};
const stopped: AutomationCampaignToday = { ...active, campaignId: "12345679", campaignName: "Stopped today", operationStatus: "DISABLE" };
const payload = { schemaVersion: 1, checkedAt: instant, clientId: client.clientId, reportingDate: client.reportingDate,
  observedAt: instant, coverage: "complete", campaigns: [active, stopped] } as const;

afterEach(() => vi.restoreAllMocks());

describe("Creator campaign picker", () => {
  it("keeps actual ROI and target separate and rejects duplicate rows or unverified stopped activity", () => {
    const parsed = automationCampaignsTodaySchema.parse(payload);
    expect(parsed.campaigns[1]).toMatchObject({ operationStatus: "DISABLE", roi: 2.5, targetRoi: 4 });
    for (const campaigns of [[active, active], [active, { ...stopped, activityToday: false }], [active, { ...stopped, roi: 4 }]]) {
      expect(automationCampaignsTodaySchema.safeParse({ ...payload, campaigns }).success).toBe(false);
    }
  });

  it("drops cross-account, stale, or prior-day reports", () => {
    const data = automationCampaignsTodaySchema.parse(payload);
    expect(campaignsTodayForClient(data, client, now)).toBe(data);
    expect(campaignsTodayForClient({ ...data, clientId: "another-creator" }, client, now)).toBeNull();
    expect(campaignsTodayForClient({ ...data, reportingDate: "2026-11-07" }, client, now)).toBeNull();
    expect(campaignsTodayForClient(data, client, now + 301_000)).toBeNull();
  });

  it("routes the switch only to an eligible Ppan row, never resumes alongside an enabled campaign", () => {
    expect(allowedLifecycleIntent(active, client.clientId, true, now)).toBe("PAUSE");
    expect(allowedLifecycleIntent(stopped, client.clientId, false, now)).toBe("RESUME");
    expect(allowedLifecycleIntent(stopped, client.clientId, true, now)).toBeNull();
    expect(allowedLifecycleIntent(active, "srihiw", true, now)).toBeNull();
    expect(allowedLifecycleIntent({ ...stopped, operationStatus: "DELETE" }, client.clientId, false, now)).toBeNull();
    const expired = { ...active, scheduleEndAt: instant };
    expect(endedTodayRow(expired, now)).toBe(true);
    expect(allowedLifecycleIntent(expired, client.clientId, true, now)).toBeNull();
  });

  it("loads history and a selected lifecycle candidate through scoped GET only", async () => {
    const exact = { clientId: client.clientId, mode: "dry-run", campaign: { campaignId: active.campaignId, campaignName: active.campaignName,
      operationStatus: "ENABLE", roiTargetTenths: 40, observedAt: instant }, capabilities: { setRoi: true, pause: true, resume: false, create: false },
      blocker: null, actionModes: { setRoi: "dry-run", pause: "dry-run", resume: "dry-run" } };
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: payload }).mockResolvedValueOnce({ data: exact }).mockResolvedValueOnce({ data: exact });
    const post = vi.spyOn(http, "post");
    await expect(fetchAutomationCampaignsToday(client.clientId)).resolves.toMatchObject({ clientId: client.clientId });
    await expect(fetchScopedCampaignControlStatus(active.campaignId)).resolves.toMatchObject({ campaign: { campaignId: active.campaignId } });
    await expect(fetchScopedCampaignControlStatus(stopped.campaignId)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(get.mock.calls.map(([path]) => path)).toEqual([`/automation/campaigns/${client.clientId}`, `/automation/campaign/status/${active.campaignId}`, `/automation/campaign/status/${stopped.campaignId}`]);
    expect(() => automationCampaignsTodayPath("../another")).toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps the create and edit form unmounted until requested from the expanded row", () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}>
      <CreatorAccountCampaigns client={{ ...client, tiktokUsername: "fixture_creator" }} userId={1} now={now} onRefreshCampaign={() => {}} onSync={async () => null} />
    </QueryClientProvider>);
    expect(html).toContain("@fixture_creator");
    expect(html).toContain("สร้างแคมเปญ");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("LIVE ROI Target");
    queryClient.clear();
  });

  it("includes every verified positive-cost row and keeps an enabled zero-cost campaign visible for management", () => {
    const noCost = { ...stopped, campaignId: "12345681", spendMinor: 0, roi: null };
    const noReport = { ...stopped, campaignId: "12345682", spendMinor: null, roi: null };
    const liveWithoutSpend = { ...active, spendMinor: 0, roi: null };
    expect(visibleCampaignBreakdown([stopped, noCost, noReport, liveWithoutSpend], now).map((row) => row.campaignId))
      .toEqual([active.campaignId, stopped.campaignId]);
  });

  it("shows campaign, status and Viewer Boost first, with the switch before the name", () => {
    const html = renderToStaticMarkup(<CreatorCampaignBreakdownTable rows={[{ ...active, skuOrders: 5, liveViews: 20 },
      { ...stopped, viewerBoostBudgetMinor: 125_000 }]} clientId={client.clientId} now={now} onEdit={() => {}} onLifecycle={() => {}} />);
    expect(html.indexOf('role="switch"')).toBeLessThan(html.indexOf(active.campaignName));
    expect(html.indexOf(">Campaign Name<")).toBeLessThan(html.indexOf(">Status<"));
    expect(html.indexOf(">Status<")).toBeLessThan(html.indexOf(">Viewer Boost<"));
    expect(html.indexOf(">Viewer Boost<")).toBeLessThan(html.indexOf(">Cost<"));
    for (const item of [active.campaignId, stopped.campaignId, "฿1,000.00", "฿2,500.00", "2.50×", "฿200.00", "฿50.00", "฿1,250.00", ">Live<", ">ปิด<"]) expect(html).toContain(item);
  });
});
