import { describe, expect, it } from "vitest";
import type { AutomationClient, AutomationPerformance } from "@/api/automation";
import type { BudgetAutoStatus, BudgetCapStatus } from "@/api/automationBudget";
import { buildCreatorOverviewRow, selectedCreators, summarizeCreatorOverview, toggleCreatorSelection } from "./creatorOverview";

const at = "2026-11-08T05:30:00.000Z";
const now = Date.parse(at);
const client: AutomationClient = {
  clientId: "srihiw", displayName: "Creator A", tiktokAccountId: "tiktok-a", advertiserId: "advertiser-a",
  access: "verified", observedAt: at, reportingDate: "2026-11-08", capMinor: null,
  actions: { start: false, pause: false, increaseBudget: false, decreaseBudget: false, auto: false },
  campaign: { campaignId: "c1", campaignName: "Synthetic campaign", campaignStatus: "ACTIVE", dailyBudgetMinor: 500_000,
    spendMinor: 300_000, targetRoi: 16, currency: "THB", scheduleStartAt: at },
};
const performance: AutomationPerformance = {
  schemaVersion: 1, checkedAt: at, observedAt: at, clientId: "srihiw", campaignId: "c1", reportingDate: "2026-11-08",
  granularity: "hour", state: "available", series: [
    { hour: "10:00", spendMinor: 1500, gmvMinor: 5000, orders: 2, liveViews: 12, roi: 3.3 },
    { hour: "12:00", spendMinor: 500, gmvMinor: 0, orders: 0, liveViews: 8, roi: 0 },
  ],
};
const cap: BudgetCapStatus = { clientId: "srihiw", capEditAllowed: true, cap: {
  campaignCapMinor: 600_000, clientDailyCapMinor: 900_000, revision: 7, locked: false, readAt: at,
} };
const auto: BudgetAutoStatus = { clientId: "srihiw", mode: "live", strategy: "continuous", evidenceMode: "spend-trend",
  grant: null, preview: null, blockers: [], overviewState: "on", continuousSession: {
    sessionId: "d5f1ea01-276b-402a-a3a6-fd44d4bed850", status: "ARMED", startedAt: at,
  },
};

describe("Creator overview data", () => {
  it("projects the current campaign and uses cost from the same report as GMV, orders and LIVE views", () => {
    expect(buildCreatorOverviewRow(client, { performance, cap, auto }, now)).toMatchObject({
      active: true, costMinor: 2000, gmvMinor: 5000, skuOrders: 2, liveViews: 20, costPerOrderMinor: 1000,
      costPerLiveViewMinor: 100, totalBudgetMinor: 500_000, maxBudgetMinor: 900_000, roiTarget: 16,
      scheduleTime: { startAt: at, endAt: null }, viewerBoostBudgetMinor: null, autoBudget: "on",
    });
  });

  it("rejects stale or mismatched data instead of substituting a different spend value", () => {
    for (const report of [
      { ...performance, clientId: "someone-else" }, { ...performance, campaignId: "old-campaign" },
      { ...performance, reportingDate: "2026-11-07" }, { ...performance, observedAt: null },
      { ...performance, observedAt: "2026-11-08T00:00:00Z" },
    ]) {
      expect(buildCreatorOverviewRow(client, { performance: report }, now)).toMatchObject({ costMinor: null, gmvMinor: null });
    }
    const missing = { ...client, observedAt: null };
    expect(buildCreatorOverviewRow(missing, { performance }, now)).toMatchObject({ active: null, access: "stale", campaignName: null });
    expect(buildCreatorOverviewRow(client, { cap: { ...cap, clientId: "nnshop5719" }, auto: { ...auto, clientId: "punpan_020" } }, now))
      .toMatchObject({ maxBudgetMinor: null, autoBudget: null });
  });

  it("preserves real zero and uses the explicit display-only Auto state", () => {
    expect(buildCreatorOverviewRow(client, { performance: { ...performance, series: [performance.series[1]!] }, auto: { ...auto, mode: "shadow", overviewState: "off" } }, now))
      .toMatchObject({ skuOrders: 0, costPerOrderMinor: null, gmvMinor: 0, autoBudget: "off" });
    for (const overviewState of ["blocked", "pending", "off", null, undefined] as const) {
      expect(buildCreatorOverviewRow(client, { auto: { ...auto, overviewState } }, now).autoBudget).toBe(overviewState ?? null);
    }
  });

  it("distinguishes a confirmed waiting session without implying that a LIVE has started", () => {
    for (const clientId of ["ashopbytheta", "bubpa_shop189"] as const) {
      const row = { ...client, clientId };
      const waiting = { ...auto, clientId, evidenceMode: "verified-room-spend-trend",
        continuousSession: { ...auto.continuousSession!, waitingForLive: true } } as const;
      expect(buildCreatorOverviewRow(row, { auto: waiting }, now).autoBudget).toBe("waiting-for-live");
      expect(buildCreatorOverviewRow(row, { auto: { ...waiting,
        continuousSession: { ...waiting.continuousSession, autoDetectLive: true } } }, now).autoBudget).toBe("detecting-live");
      expect(buildCreatorOverviewRow(row, { auto: { ...waiting,
        continuousSession: { ...waiting.continuousSession, autoDetectLive: true, keepAutoAcrossRooms: true } } }, now).autoBudget).toBe("persistent-wait");
      expect(buildCreatorOverviewRow(row, { auto: { ...waiting, overviewState: "blocked" } }, now).autoBudget).toBe("blocked");
      expect(buildCreatorOverviewRow({ ...row, monitoringOnly: true }, { auto: waiting }, now).autoBudget).toBeNull();
    }
  });

  it("weights costs using only matched source pairs, includes zero-count cost, and exposes partial coverage", () => {
    const a = buildCreatorOverviewRow(client, { performance }, now);
    const totals = summarizeCreatorOverview([
      a, { ...a, clientId: "b", costMinor: 1600, skuOrders: 0, liveViews: 20 },
      { ...a, clientId: "c", costMinor: 10_000, skuOrders: null, liveViews: null },
      { ...a, clientId: "d", active: null }, { ...a, clientId: "e", active: false },
    ]);
    expect(totals.activeAccounts).toEqual({ value: 3, known: 4, eligible: 5 });
    expect(totals.costMinor).toEqual({ value: 13_600, known: 3, eligible: 4 });
    expect(totals.costPerOrderMinor).toEqual({ value: 1800, known: 2, eligible: 4 });
    expect(totals.costPerLiveViewMinor).toEqual({ value: 90, known: 2, eligible: 4 });
    expect(summarizeCreatorOverview([]).costMinor.value).toBeNull();
  });

  it("filters to more than one selected Creator and never accepts an unknown Creator ID", () => {
    const ids = ["a", "b", "c", "d"];
    const rows = ids.map((clientId) => ({ clientId }));
    let selection = toggleCreatorSelection(null, "a", ids);
    selection = toggleCreatorSelection(selection, "d", ids);
    expect(selectedCreators(rows, selection).map(({ clientId }) => clientId)).toEqual(["b", "c"]);
    expect(toggleCreatorSelection(selection, "not-available", ids)).toBe(selection);
    expect(selectedCreators(rows, new Set())).toEqual([]);
    expect(selectedCreators(rows, null)).toHaveLength(4);
  });
});
