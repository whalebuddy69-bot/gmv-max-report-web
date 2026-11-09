import { describe, expect, it } from "vitest";
import type { AutomationDiscoveredLiveCampaign } from "@/api/automationLiveDiscovery";
import { groupLiveDiscoveryCampaigns } from "./liveDiscoveryGroups";

const advertiserA = "9000000000001";
const advertiserB = "9000000000002";
const advertiserC = "9000000000003";
const shopA = "9000000001101";
const shopB = "9000000001102";
const enabled = "CAMPAIGN_STATUS_ENABLE";
const outOfBudget = "CAMPAIGN_STATUS_BUDGET_EXCEED";

function campaign(number: number, overrides: Partial<AutomationDiscoveredLiveCampaign> = {}): AutomationDiscoveredLiveCampaign {
  return {
    advertiserId: advertiserA, advertiserName: "Advertiser A", campaignId: String(9_000_000_000_100 + number),
    campaignName: `Synthetic campaign ${number}`, kind: "creator", secondaryStatus: enabled,
    tiktokUsername: null, shopName: null, ...overrides,
  };
}

describe("LIVE discovery groups", () => {
  it("merges only exact Seller Shop IDs and preserves advertiser and campaign order", () => {
    const a = campaign(1, { kind: "shop", shopId: shopA });
    const b = campaign(1, { advertiserId: advertiserB, advertiserName: "Advertiser B", kind: "shop", shopId: shopA, shopName: "Same shop name" });
    const c = campaign(2, { advertiserId: advertiserB, kind: "shop", shopId: shopB, shopName: b.shopName });
    const d = campaign(3, { advertiserName: "Renamed Advertiser A", kind: "shop", shopId: shopA, shopName: "Later name" });
    const groups = groupLiveDiscoveryCampaigns([a, c, b, d]);

    expect(groups.map(({ key }) => key)).toEqual([`shop:${shopA}`, `shop:${shopB}`]);
    expect(groups[0]).toMatchObject({ kind: "shop", shopId: shopA, name: "Same shop name", campaigns: [a, b, d],
      advertisers: [{ id: advertiserA, name: "Advertiser A" }, { id: advertiserB, name: "Advertiser B" }] });
    expect(groups[1]).toMatchObject({ shopId: shopB, campaigns: [c] });
    expect(groups[0]?.campaigns[1]).toBe(b);
  });

  it("does not group unverifiable Seller identities by label, advertiser or campaign ID alone", () => {
    const a = campaign(1, { kind: "shop", shopId: null, shopName: "Shared label" });
    const b = campaign(2, { kind: "shop", shopName: a.shopName });
    const c = campaign(1, { kind: "shop", advertiserId: advertiserB, shopName: a.shopName });
    const d = campaign(3, { kind: "shop" });
    const groups = groupLiveDiscoveryCampaigns([a, b, c, d]);
    expect(groups.map(({ campaigns }) => campaigns)).toEqual([[a], [b], [c], [d]]);
    expect(new Set(groups.map(({ key }) => key)).size).toBe(4);
    expect(groups.every(({ shopId }) => shopId === null)).toBe(true);
    expect(groups[3]?.name).toBe("ยังไม่ทราบชื่อร้าน");
    expect(groupLiveDiscoveryCampaigns([d, a, b, c])[1]?.key).toBe(groups[0]?.key);
  });

  it("keeps Creator and unknown advertiser scopes separate and preserves exact first enrollment rows", () => {
    const a = campaign(1, { tiktokUsername: "First.Creator" });
    const duplicate = campaign(2, { tiktokUsername: "first.creator" });
    const second = campaign(3, { tiktokUsername: "second.creator" });
    const unknown = campaign(4, { kind: "unknown", tiktokUsername: "First.Creator" });
    const unknown2 = campaign(5, { kind: "unknown" });
    const otherAdvertiser = campaign(1, { advertiserId: advertiserB, tiktokUsername: "FIRST.CREATOR" });
    const unverified = campaign(6);
    const seller = campaign(7, { kind: "shop", shopId: shopA, tiktokUsername: "Second.Creator" });
    const groups = groupLiveDiscoveryCampaigns([a, unknown, duplicate, second, otherAdvertiser, unverified, unknown2, seller]);
    expect(groups.map(({ key }) => key)).toEqual([`creator:${advertiserA}`, `unknown:${advertiserA}`, `creator:${advertiserB}`, `shop:${shopA}`]);
    expect(groups[0]?.campaigns).toEqual([a, duplicate, second, unverified]);
    expect(groups[0]?.creatorEnrollments).toEqual([a, second]);
    expect(groups[0]?.creatorEnrollments[0]).toBe(a);
    expect(groups[1]?.campaigns).toEqual([unknown, unknown2]);
    expect(groups[1]?.creatorEnrollments).toEqual([]);
    expect(groups[2]?.creatorEnrollments).toEqual([otherAdvertiser]);
    expect(groups[3]?.creatorEnrollments).toEqual([]);
  });

  it("distinguishes warnings from missing status and reports a uniform code only when every row agrees", () => {
    const rows = [
      campaign(1), campaign(2, { secondaryStatus: null }), campaign(3, { secondaryStatus: "UNRECOGNIZED_STATUS" }),
      campaign(4, { advertiserId: advertiserB, secondaryStatus: outOfBudget }),
      campaign(5, { advertiserId: advertiserB, secondaryStatus: outOfBudget }),
      campaign(6, { advertiserId: advertiserC, secondaryStatus: null }),
      campaign(7, { advertiserId: advertiserC, secondaryStatus: null }),
      campaign(8, { kind: "shop", shopId: shopA }), campaign(9, { kind: "shop", shopId: shopA }),
    ];
    expect(groupLiveDiscoveryCampaigns(rows).map(({ warningCount, unknownStatusCount, uniformStatus }) => ({ warningCount, unknownStatusCount, uniformStatus }))).toEqual([
      { warningCount: 1, unknownStatusCount: 1, uniformStatus: null },
      { warningCount: 2, unknownStatusCount: 0, uniformStatus: outOfBudget },
      { warningCount: 0, unknownStatusCount: 2, uniformStatus: null },
      { warningCount: 0, unknownStatusCount: 0, uniformStatus: enabled },
    ]);
    expect(groupLiveDiscoveryCampaigns([rows[1]!, rows[0]!, campaign(10)])[0]?.uniformStatus).toBeNull();
  });

  it("does not mutate input or retain state between calls", () => {
    const row = Object.freeze(campaign(1));
    const input = Object.freeze([row]);
    expect(groupLiveDiscoveryCampaigns([])).toEqual([]);
    const first = groupLiveDiscoveryCampaigns(input);
    first[0]?.campaigns.pop();
    expect(groupLiveDiscoveryCampaigns(input)[0]?.campaigns).toEqual([row]);
  });
});
