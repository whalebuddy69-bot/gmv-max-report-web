import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automationLiveDiscoverySchema,
  enrollDiscoveredCreator,
  fetchAutomationLiveDiscovery,
  refreshAutomationLiveDiscovery,
  type AutomationLiveDiscovery,
} from "@/api/automationLiveDiscovery";
import { ApiError, http } from "@/api/client";
import { filterDiscoveredLiveCampaigns, LiveCampaignDiscovery, LiveCampaignDiscoveryContent, liveDiscoveryPollingInterval } from "./LiveCampaignDiscovery";

const ads = "9000000000001";
const shopId = "9000000001101";
const shop = {
  advertiserId: ads, advertiserName: "Synthetic advertiser",
  campaignId: "9000000000101", campaignName: "Fixture LIVE shop", secondaryStatus: null,
  kind: "shop", tiktokUsername: null, shopName: "ร้านตัวอย่าง", shopId,
} as const;
const creator = {
  advertiserId: ads, advertiserName: shop.advertiserName,
  campaignId: "9000000000102", campaignName: "Fixture LIVE creator",
  secondaryStatus: "CAMPAIGN_STATUS_ENABLE", kind: "creator", tiktokUsername: "verified.creator", shopName: null,
} as const;
const snapshot: AutomationLiveDiscovery = {
  schemaVersion: 1, state: "ready", checkedAt: "2026-11-09T11:26:35.035Z",
  accountsChecked: 61, accountsTotal: 61, campaigns: [shop, creator],
};
const render = (value = snapshot, error = false) => renderToStaticMarkup(
  <LiveCampaignDiscoveryContent snapshot={value} error={error} pending={false} refreshing={value.state === "refreshing"} onRefresh={() => {}} />,
);
const summaryRows = (html: string) => html.match(/<tr\b[^>]*data-discovery-summary[^>]*>.*?<\/tr>/g) ?? [];

afterEach(() => vi.restoreAllMocks());

describe("LIVE GMV Max discovery", () => {
  it("validates IDs, usernames, Shop linking and complete coverage; allows equal campaign IDs on different advertisers", () => {
    expect(automationLiveDiscoverySchema.safeParse(snapshot).success).toBe(true);
    for (const row of [
      { ...shop, advertiserId: "../anything" },
      { ...shop, tiktokUsername: "@unverified" },
      { ...shop, tiktokUsername: "unverified." },
      { ...shop, kind: "creator" },
      { ...shop, kind: "unknown", shopName: null },
    ]) expect(automationLiveDiscoverySchema.safeParse({ ...snapshot, campaigns: [row] }).success).toBe(false);
    expect(automationLiveDiscoverySchema.safeParse({ ...snapshot, accountsChecked: 60 }).success).toBe(false);
    expect(automationLiveDiscoverySchema.safeParse({ ...snapshot, accountsChecked: 62 }).success).toBe(false);
    expect(automationLiveDiscoverySchema.safeParse({ ...snapshot, campaigns: [shop, shop] }).success).toBe(false);
    expect(automationLiveDiscoverySchema.safeParse({
      ...snapshot, campaigns: [shop, { ...shop, advertiserId: "9000000000002" }],
    }).success).toBe(true);
  });

  it("reads the snapshot, then refreshes only through the explicit endpoint without a request body", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValue({ data: snapshot });
    const post = vi.spyOn(http, "post").mockResolvedValue({ data: { ...snapshot, state: "refreshing" } });
    const { signal } = new AbortController();
    expect(await fetchAutomationLiveDiscovery(signal)).toEqual(snapshot);
    expect(await refreshAutomationLiveDiscovery(signal)).toMatchObject({ state: "refreshing", campaigns: snapshot.campaigns });
    expect(get).toHaveBeenCalledWith("/automation/live-discovery", { signal });
    expect(post).toHaveBeenCalledWith("/automation/live-discovery/refresh", undefined, { signal });
  });

  it("enrolls only the exact advertiser, campaign and verified username, and checks response binding", async () => {
    const input = { advertiserId: creator.advertiserId, campaignId: creator.campaignId, expectedUsername: creator.tiktokUsername };
    const result = { clientId: "creator_fixture", advertiserId: input.advertiserId };
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: result }).mockResolvedValueOnce({ data: { ...result, advertiserId: "9000000000002" } });
    const { signal } = new AbortController();
    await expect(enrollDiscoveredCreator({ ...input, expectedUsername: "@verified.creator" }, signal)).rejects.toMatchObject({ code: "INVALID_CREATOR_ENROLLMENT" });
    expect(post).not.toHaveBeenCalled();
    await expect(enrollDiscoveredCreator(input, signal)).resolves.toEqual(result);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/automation/live-discovery/enroll", input, { signal });
    await expect(enrollDiscoveredCreator(input, signal)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
  });

  it("only offers enrollment for a verified Creator in an unmanaged advertiser with explicit capability", () => {
    const view = (value: AutomationLiveDiscovery, managedAdvertiserIds = new Set<string>(), refreshing = false) => renderToStaticMarkup(
      <LiveCampaignDiscoveryContent snapshot={value} error={false} pending={false} refreshing={refreshing} onRefresh={() => {}}
        managedAdvertiserIds={managedAdvertiserIds} onSelectCreator={() => {}} />,
    );
    const available: AutomationLiveDiscovery = { ...snapshot, canAddCreators: true, campaigns: [
      { ...shop, tiktokUsername: "verified.shop" }, creator,
      { ...creator, campaignId: "9000000000103", tiktokUsername: null },
      { ...creator, campaignId: "9000000000104", kind: "unknown", tiktokUsername: "verified.other" },
    ] };
    const eligible = view(available);
    expect(eligible.match(/เพิ่มในบัญชี Creator/g)).toHaveLength(1);
    expect(summaryRows(eligible).some(row => row.includes('aria-label="เพิ่มในบัญชี Creator @verified.creator"'))).toBe(true);
    const managed = view(available, new Set([ads]));
    expect(managed).toContain("มีในบัญชี Creator แล้ว");
    expect(managed).not.toContain("เพิ่มในบัญชี Creator");
    expect(view(available, new Set(), true)).not.toContain("เพิ่มในบัญชี Creator");
    expect(view({ ...available, state: "unavailable" })).not.toContain("เพิ่มในบัญชี Creator");
    expect(view(snapshot)).not.toContain("เพิ่มในบัญชี Creator");
    const multi = view({ ...available, campaigns: [...available.campaigns, { ...creator, campaignId: "9000000000105", tiktokUsername: "second.channel" }] });
    expect(multi).toContain("เลือกช่อง Creator เพื่อติดตามจาก Synthetic advertiser");
    expect(multi).not.toContain('aria-label="เพิ่มในบัญชี Creator @verified.creator"');
  });

  it("shows real table headers and keeps statuses in summary rows without exposing controls or closed campaign details", () => {
    const html = render();
    expect(html).toContain("LIVE GMV Max ที่เปิดสวิตช์");
    expect(html).toContain("อ่านอย่างเดียว");
    expect(html).toContain("ไม่ได้ยืนยันว่ากำลังไลฟ์หรือส่งโฆษณา");
    expect(html).toContain("การไลฟ์ไม่เพิ่มสิทธิ์จัดการ");
    expect(html).toMatch(/<thead[^>]*>.*บัญชี \/ ร้านค้า.*สถานะ.*แคมเปญ.*<\/thead>/);
    const summaries = summaryRows(html);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatch(/lucide-store.*ร้านค้า.*ร้านตัวอย่าง.*เปิดอยู่.*ไม่ทราบการส่ง/);
    expect(summaries[1]).toMatch(/lucide-user-round.*ครีเอเตอร์.*Synthetic advertiser.*เปิดอยู่/);
    expect(summaries[0]).toContain('aria-label="ดู 1 แคมเปญของ ร้านตัวอย่าง"');
    expect(html).not.toContain("Fixture LIVE shop");
    expect(html).not.toContain("Fixture LIVE creator");
    expect(html).not.toContain("@verified.creator");
    expect(html).toContain('aria-label="กรองประเภทบัญชี"');
    expect(html).toMatch(/aria-pressed="true">ทั้งหมด.*aria-pressed="false">Creator.*aria-pressed="false">Seller/);
    expect(html).toContain("เปิดอยู่");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("aria-checked");
    expect(html).not.toContain("@Synthetic advertiser");
    expect(html).not.toContain("เพิ่มงบอัตโนมัติ");
    expect(html).not.toContain("แก้ไขงบ");
  });

  it("labels an unknown Shop without replacing its name with an advertiser label", () => {
    const html = render({ ...snapshot, campaigns: [{ ...shop, shopName: null }] });
    expect(summaryRows(html)[0]).toMatch(/lucide-store.*ร้านค้า.*ยังไม่ทราบชื่อร้าน/);
    expect(html).toContain(`data-discovery-group="shop:${shopId}"`);
    expect(html).not.toContain("ร้านค้า · Synthetic advertiser");
  });

  it("filters by both provider IDs and names without modifying the scope", () => {
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, " @VERIFIED.CREATOR ")).toEqual([creator]);
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, shopId)).toEqual([shop]);
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, "ร้านตัวอย่าง")).toEqual([shop]);
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, ads)).toEqual([shop, creator]);
  });

  it("keeps unverified types in All only, combines filters with search and shows delivery warnings", () => {
    const unknown = { ...creator, campaignId: "9000000000103", kind: "unknown", tiktokUsername: "unknown.type",
      secondaryStatus: "CAMPAIGN_STATUS_BUDGET_EXCEED" } as const;
    const rows = [shop, creator, unknown];
    expect(filterDiscoveredLiveCampaigns(rows, "", "all")).toEqual(rows);
    expect(filterDiscoveredLiveCampaigns(rows, ads, "creator")).toEqual([creator]);
    expect(filterDiscoveredLiveCampaigns(rows, "ร้านตัวอย่าง", "shop")).toEqual([shop]);
    expect(filterDiscoveredLiveCampaigns(rows, "unknown.type", "creator")).toEqual([]);
    expect(filterDiscoveredLiveCampaigns(rows, "unknown.type", "shop")).toEqual([]);
    const html = render({ ...snapshot, campaigns: rows });
    expect(summaryRows(html)[2]).toMatch(/lucide-circle-help.*ไม่ทราบประเภท.*งบแคมเปญหมด.*lucide-triangle-alert.*งบหมด/);
  });

  it("counts all open campaigns on one verified shop row even across different ad accounts", () => {
    const campaigns = [shop, { ...shop, advertiserId: "9000000000002", campaignId: "9000000000105", tiktokUsername: "another.channel",
      secondaryStatus: "CAMPAIGN_STATUS_BUDGET_EXCEED" }, { ...shop, shopId: "9000000001102", campaignId: "9000000000106" }] as const;
    const html = render({ ...snapshot, campaigns: [...campaigns] });
    expect(summaryRows(html)).toHaveLength(2);
    expect(summaryRows(html)[0]).toMatch(/ร้านตัวอย่าง.*2 Ad Accounts.*เปิดอยู่.*เตือน 1.*ไม่ทราบ 1.*ดู 2 แคมเปญ/);
    expect(summaryRows(html)[1]).toContain('aria-label="ดู 1 แคมเปญของ ร้านตัวอย่าง"');
    expect(html).not.toContain("@another.channel");
  });

  it("uses cached rows during refresh and never reports a partial scan as no live campaigns", () => {
    expect(render({ ...snapshot, state: "refreshing" })).toContain("ร้านตัวอย่าง");
    expect(render({ ...snapshot, state: "refreshing" })).toContain("แสดงข้อมูลจากรอบล่าสุดระหว่างรอ");
    expect(render({ ...snapshot, state: "partial", accountsChecked: 60, campaigns: [] })).not.toContain("ไม่พบแคมเปญ LIVE GMV Max");
    expect(render({ ...snapshot, state: "ready", campaigns: [] }, true)).not.toContain("ไม่พบแคมเปญ LIVE GMV Max");
    expect(render({ ...snapshot, state: "ready", campaigns: [] })).toContain("ไม่พบแคมเปญ LIVE GMV Max");
  });

  it("slows when ready or stale and stops polling or showing cached data on denied access", () => {
    const forbidden = new ApiError("Forbidden", { code: "FORBIDDEN", status: 403 });
    expect(liveDiscoveryPollingInterval(snapshot, null, 0)).toBe(60_000);
    expect(liveDiscoveryPollingInterval({ ...snapshot, state: "refreshing" }, null, 20_000)).toBe(10_000);
    expect(liveDiscoveryPollingInterval({ ...snapshot, state: "refreshing" }, null, 4 * 60_000)).toBe(60_000);
    expect(liveDiscoveryPollingInterval(snapshot, forbidden, 0)).toBe(false);
    const cache = new QueryClient();
    const key = ["automation", "live-discovery", 17];
    cache.setQueryData(key, snapshot);
    cache.getQueryCache().find({ queryKey: key })?.setState({ error: forbidden, status: "error" });
    const html = renderToStaticMarkup(<QueryClientProvider client={cache}><LiveCampaignDiscovery userId={17} /></QueryClientProvider>);
    expect(html).toBe("");
    cache.clear();
  });
});
