import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID, type AutomationClient, type AutomationOverview } from "@/api/automation";
import { MAX_OBSERVATION_AGE_MS } from "@/lib/automation";
import { invalidateOtherAutoBudgetViews } from "./AutoBudgetStatusPanel";
import { CreatorCampaignEditPanel, CreatorCampaignSchedule, CreatorEditBudgetMeter, creatorEditControlScope, findEditableCreatorCampaign, getCreatorEditSync, isCreatorEditSyncCurrent } from "./CreatorOverviewEdit";

const readAt = "2026-11-08T04:00:00.000Z";
const now = Date.parse(readAt) + 1_000;
const client: AutomationClient = {
  clientId: PILOT_BUDGET_CLIENT_ID,
  displayName: "Ppan",
  advertiserId: "synthetic-advertiser",
  tiktokAccountId: "synthetic-tiktok",
  access: "verified",
  reportingDate: "2026-11-08",
  observedAt: readAt,
  campaign: { campaignId: "synthetic-campaign", campaignName: "Synthetic Campaign", campaignStatus: "ACTIVE", dailyBudgetMinor: 3_000_00, spendMinor: 2_500_00, targetRoi: 28, currency: "THB" },
  capMinor: null,
  actions: { start: false, pause: false, increaseBudget: false, decreaseBudget: false, auto: false },
};
const overview = (...clients: AutomationClient[]): AutomationOverview => ({
  schemaVersion: 1, checkedAt: readAt, coverage: "configured-creators-only", clients,
});
const selected = { ...client.campaign!, operationStatus: "ENABLE" } as const;

afterEach(() => vi.restoreAllMocks());

describe("creator overview edit scope", () => {
  it("makes explicit, fresh sync local to the exact creator, advertiser and TikTok account", () => {
    expect(getCreatorEditSync(null, client, now)).toBeNull();
    expect(getCreatorEditSync(overview(), client, now)).toBeNull();
    expect(getCreatorEditSync(overview({ ...client, clientId: "srihiw" }), client, now)).toBeNull();
    expect(getCreatorEditSync(overview({ ...client, advertiserId: "different-ads" }), client, now)).toBeNull();
    expect(getCreatorEditSync(overview({ ...client, tiktokAccountId: "different-account" }), client, now)).toBeNull();
    expect(getCreatorEditSync(overview({ ...client, access: "unavailable" }), client, now)).toBeNull();
    expect(getCreatorEditSync(overview({ ...client, reportingDate: "2026-11-07" }), client, now)).toBeNull();
    expect(isCreatorEditSyncCurrent(getCreatorEditSync(overview(client), client, now), client, now)).toBe(true);
  });

  it("does not transfer a sync to another campaign, day or an expired snapshot even when polling has fresher data", () => {
    const sync = getCreatorEditSync(overview(client), client, now);
    const nextCampaign = { ...client, campaign: { ...client.campaign!, campaignId: "next-campaign" } };
    const afterExpiry = Date.parse(readAt) + MAX_OBSERVATION_AGE_MS + 1;
    expect(isCreatorEditSyncCurrent(sync, nextCampaign, now)).toBe(false);
    expect(isCreatorEditSyncCurrent(sync, { ...client, campaign: null }, now)).toBe(false);
    expect(isCreatorEditSyncCurrent(sync, { ...client, access: "unavailable" }, now)).toBe(false);
    expect(isCreatorEditSyncCurrent(sync, { ...client, reportingDate: "2026-11-07" }, now)).toBe(false);
    expect(isCreatorEditSyncCurrent(sync, { ...client, observedAt: new Date(afterExpiry).toISOString() }, afterExpiry)).toBe(false);
  });

  it("routes each supported creator to its own controls; a row selection never passes an arm campaign", () => {
    for (const clientId of [PILOT_BUDGET_CLIENT_ID, "srihiw", "nnshop5719", "ashopbytheta"]) {
      const row = { ...client, clientId };
      expect(creatorEditControlScope(row, null, now)).toEqual({
        syncCurrent: false, budgetClientId: clientId, autoClientId: clientId, autoCampaignId: null,
        campaignControl: clientId === PILOT_BUDGET_CLIENT_ID,
      });
      expect(creatorEditControlScope(row, getCreatorEditSync(overview(row), row, now), now).autoCampaignId).toBe(client.campaign?.campaignId);
    }
    const unknown = { ...client, clientId: "other-creator" };
    expect(creatorEditControlScope(unknown, null, now)).toEqual({
      syncCurrent: false, budgetClientId: null, autoClientId: null, autoCampaignId: null, campaignControl: false,
    });
  });

  it("keeps the scoped Stop/status path reachable without a fresh campaign and allows cap-only sync", () => {
    const noCampaign = { ...client, campaign: null };
    const sync = getCreatorEditSync(overview(noCampaign), noCampaign, now);
    expect(creatorEditControlScope(noCampaign, sync, now)).toMatchObject({ syncCurrent: true, autoCampaignId: null, autoClientId: client.clientId });
    const offline = { ...noCampaign, access: "unavailable" as const, budgetControlAvailable: false };
    expect(creatorEditControlScope(offline, sync, now)).toMatchObject({ syncCurrent: false, budgetClientId: null, autoCampaignId: null, autoClientId: client.clientId });
  });

  it("allows only the exact active campaign and does not edit ended or expired data", () => {
    expect(findEditableCreatorCampaign(client, selected, now)).toEqual(client.campaign);
    expect(findEditableCreatorCampaign(client, { ...selected, campaignId: "another" }, now)).toBeNull();
    expect(findEditableCreatorCampaign(client, { ...selected, operationStatus: "DISABLE" }, now)).toBeNull();
    expect(findEditableCreatorCampaign(client, { ...selected, operationStatus: "DELETE" }, now)).toBeNull();
    expect(findEditableCreatorCampaign(client, { ...selected, scheduleEndAt: readAt }, now)).toBeNull();
    expect(findEditableCreatorCampaign({ ...client, campaign: { ...client.campaign!, scheduleEndAt: readAt } }, selected, now)).toBeNull();
    expect(findEditableCreatorCampaign(client, selected, now + MAX_OBSERVATION_AGE_MS)).toBeNull();
  });

  it("renders a compact exact edit with current reported ROI and the proper units, without a review ROI button", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}>
      <CreatorCampaignEditPanel client={client} campaign={selected} actualRoi={7.3} userId={1} now={now} onBack={() => {}}
        onRefreshCampaign={() => {}} onSync={async () => null} />
    </QueryClientProvider>);
    const sections = ["ตั้งค่าแคมเปญ", "ROI จริงวันนี้", "LIVE ROI Target", "Daily budget", "Auto budget increase", "Daily Ceiling", "Schedule", "Campaign Name"];
    const positions = sections.map((section) => html.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain("Daily budget (THB)");
    expect(html).toContain("Daily Ceiling (THB)");
    expect(html).toContain("×");
    expect(html).toContain("7.30×");
    expect(html).toContain("กลับไปรายการ");
    expect(html).toContain('data-layout="campaign-settings-grid"');
    expect(html).toContain('data-layout="compact-auto-row"');
    expect(html).not.toContain("ใช้ถึง 80% → เพิ่มงบ 20%");
    expect(html).not.toContain('role="tab');
    expect(html).not.toContain("ตรวจ ROI");
    expect(html).toContain("Sync บัญชีนี้ก่อนแก้งบ");
    queryClient.clear();
  });

  it("renders only historical settings on a closed selection while a different campaign is active", () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}>
      <CreatorCampaignEditPanel client={client} campaign={{ campaignId: "closed-campaign", campaignName: "Old Session", operationStatus: "DISABLE", dailyBudgetMinor: 125_000, targetRoi: 4.5 }}
        actualRoi={1.5} userId={1} now={now} onBack={() => {}} onRefreshCampaign={() => {}} onSync={async () => null} />
    </QueryClientProvider>);
    expect(html).toContain("closed-campaign");
    expect(html).toContain("Old Session");
    expect(html).toContain('value="1,250.00"');
    expect(html).toContain('value="4.50"');
    expect(html).toContain("1.50×");
    expect(html).not.toContain("Synthetic Campaign");
    expect(html).not.toContain("3,000.00");
    expect(html).not.toContain("Sync แคมเปญนี้");
    expect(html).not.toContain("Daily Ceiling");
    expect(html).not.toContain("Auto budget increase");
    queryClient.clear();
  });

  it("renders verified schedules in Bangkok time with a read-only end indicator", () => {
    const campaign = client.campaign!;
    const scheduled = renderToStaticMarkup(<CreatorCampaignSchedule campaign={{ ...campaign,
      scheduleStartAt: "2026-11-08T19:12:00Z", scheduleEndAt: "2026-11-09T21:34:00Z",
    }} />);
    expect(scheduled).toContain("2026-11-09 02:12");
    expect(scheduled).toContain("2026-11-10 04:34");
    expect(scheduled).toContain("Synthetic Campaign");
    expect(scheduled).toMatch(/<input[^>]+role="switch"[^>]+disabled=""[^>]+checked=""/);
    const openEnded = renderToStaticMarkup(<CreatorCampaignSchedule campaign={{ ...campaign, scheduleStartAt: readAt, scheduleEndAt: null }} />);
    expect(openEnded).toContain("ไม่กำหนดวันสิ้นสุด");
    expect(openEnded).not.toContain('checked=""');
    for (const unknown of [campaign, { ...campaign, scheduleStartAt: readAt }, { ...campaign, scheduleStartAt: null, scheduleEndAt: null }, null]) {
      const markup = renderToStaticMarkup(<CreatorCampaignSchedule campaign={unknown} />);
      expect(markup).toContain("ยังยืนยันการตั้งวันสิ้นสุดไม่ได้");
      expect(markup).not.toContain('role="switch"');
    }
  });

  it("shows the budget threshold without treating unknown spend as zero or progress as a write", () => {
    const campaign = client.campaign!;
    const current = renderToStaticMarkup(<CreatorEditBudgetMeter campaign={campaign} />);
    expect(current).toContain("83.33% ของงบแคมเปญ");
    expect(current).toContain("ไม่ได้ยืนยันว่า Auto เพิ่มงบแล้ว");
    expect(renderToStaticMarkup(<CreatorEditBudgetMeter campaign={{ ...campaign, spendMinor: null }} />)).not.toContain('role="meter"');
    expect(renderToStaticMarkup(<CreatorEditBudgetMeter campaign={{ ...campaign, spendMinor: 2 * campaign.dailyBudgetMinor }} />)).toContain('aria-valuenow="100"');
  });

  it("invalidates only sibling Auto status views of the same operator and creator", async () => {
    const queryClient = new QueryClient();
    const drawer = ["automation", "budget-auto-status", 1, PILOT_BUDGET_CLIENT_ID, null];
    const overviewRow = ["automation", "budget-auto-status", 1, PILOT_BUDGET_CLIENT_ID, "campaign-a"];
    const overviewSummary = ["automation", "budget-auto-overview", 1, PILOT_BUDGET_CLIENT_ID];
    const otherSummary = ["automation", "budget-auto-overview", 1, "srihiw"];
    const otherCreator = ["automation", "budget-auto-status", 1, "srihiw", "campaign-b"];
    const otherOperator = ["automation", "budget-auto-status", 2, PILOT_BUDGET_CLIENT_ID, "campaign-a"];
    for (const key of [drawer, overviewRow, overviewSummary, otherSummary, otherCreator, otherOperator]) queryClient.setQueryData(key, "sample");
    await invalidateOtherAutoBudgetViews(queryClient, 1, PILOT_BUDGET_CLIENT_ID, null);
    expect(queryClient.getQueryState(overviewRow)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(overviewSummary)?.isInvalidated).toBe(true);
    for (const key of [drawer, otherSummary, otherCreator, otherOperator]) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    queryClient.clear();
  });
});
