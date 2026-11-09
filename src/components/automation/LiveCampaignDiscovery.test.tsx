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
    expect(view(available).match(/เพิ่มในบัญชี Creator/g)).toHaveLength(1);
    const managed = view(available, new Set([ads]));
    expect(managed).toContain("มีในบัญชี Creator แล้ว");
    expect(managed).not.toContain("เพิ่มในบัญชี Creator");
    expect(view(available, new Set(), true)).not.toContain("เพิ่มในบัญชี Creator");
    expect(view({ ...available, state: "unavailable" })).not.toContain("เพิ่มในบัญชี Creator");
    expect(view(snapshot)).not.toContain("เพิ่มในบัญชี Creator");
  });

  it("groups the advertiser by exact ID, shows Shop identity without inventing a username and never exposes controls", () => {
    const html = render();
    expect(html).toContain("LIVE GMV Max ที่เปิดสวิตช์");
    expect(html).toContain("อ่านอย่างเดียว");
    expect(html).toContain("ไม่ได้ยืนยันว่ากำลังไลฟ์หรือส่งโฆษณา");
    expect(html).toContain("การไลฟ์ไม่เพิ่มสิทธิ์จัดการ");
    expect(html.match(new RegExp(`Ad Account ${ads}`, "g"))).toHaveLength(1);
    expect(html).toContain("lucide-store");
    expect(html).toContain("ร้านค้า · ร้านตัวอย่าง");
    expect(html).toContain("ยังไม่ยืนยัน @username");
    expect(html).toContain("@verified.creator");
    expect(html).toContain("เปิดอยู่");
    expect(html).toContain("ดูรายละเอียดแคมเปญ");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("aria-checked");
    expect(html).not.toContain("@Synthetic advertiser");
    expect(html).not.toContain("เพิ่มงบอัตโนมัติ");
    expect(html).not.toContain("แก้ไขงบ");
  });

  it("labels an unknown Shop without replacing its name with an advertiser label", () => {
    const html = render({ ...snapshot, campaigns: [{ ...shop, shopName: null }] });
    expect(html).toContain("ร้านค้า · ยังไม่ทราบชื่อ");
    expect(html).toContain(`Shop ID ${shopId}`);
    expect(html).not.toContain("ร้านค้า · Synthetic advertiser");
  });

  it("filters by both provider IDs and names without modifying the scope", () => {
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, " @VERIFIED.CREATOR ")).toEqual([creator]);
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, shopId)).toEqual([shop]);
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, "ร้านตัวอย่าง")).toEqual([shop]);
    expect(filterDiscoveredLiveCampaigns(snapshot.campaigns, ads)).toEqual([shop, creator]);
  });

  it("uses cached rows during refresh and never reports a partial scan as no live campaigns", () => {
    expect(render({ ...snapshot, state: "refreshing" })).toContain("Fixture LIVE shop");
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
