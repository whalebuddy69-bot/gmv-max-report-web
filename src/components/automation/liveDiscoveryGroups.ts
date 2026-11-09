import type { AutomationDiscoveredLiveCampaign } from "@/api/automationLiveDiscovery";

type Campaign = AutomationDiscoveredLiveCampaign;
type CreatorEnrollment = Campaign & { kind: "creator"; tiktokUsername: string };

export type LiveDiscoveryGroup = {
  key: string;
  kind: Campaign["kind"];
  name: string;
  shopId: string | null;
  campaigns: Campaign[];
  advertisers: { id: string; name: string }[];
  warningCount: number;
  unknownStatusCount: number;
  uniformStatus: string | null;
  creatorEnrollments: CreatorEnrollment[];
};

function groupKey(row: Campaign) {
  if (row.kind === "shop") {
    // Shop names are display text, never identity. The same campaign ID may
    // legitimately occur under different advertisers in the discovery schema.
    return row.shopId ? `shop:${row.shopId}` : `shop-campaign:${row.advertiserId}:${row.campaignId}`;
  }
  return `${row.kind}:${row.advertiserId}`;
}

function isCreatorEnrollment(row: Campaign): row is CreatorEnrollment {
  return row.kind === "creator" && row.tiktokUsername !== null;
}

export function groupLiveDiscoveryCampaigns(rows: readonly Campaign[]): LiveDiscoveryGroup[] {
  const grouped = new Map<string, {
    group: LiveDiscoveryGroup;
    advertiserIds: Set<string>;
    usernames: Set<string>;
    hasShopName: boolean;
  }>();

  for (const row of rows) {
    const key = groupKey(row);
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        group: {
          key, kind: row.kind,
          name: row.kind === "shop" ? row.shopName ?? "ยังไม่ทราบชื่อร้าน" : row.advertiserName,
          shopId: row.kind === "shop" ? row.shopId ?? null : null,
          campaigns: [], advertisers: [], warningCount: 0, unknownStatusCount: 0,
          uniformStatus: row.secondaryStatus, creatorEnrollments: [],
        },
        advertiserIds: new Set(), usernames: new Set(), hasShopName: row.shopName !== null,
      };
      grouped.set(key, entry);
    }

    const { group, advertiserIds, usernames } = entry;
    if (row.kind === "shop" && !entry.hasShopName && row.shopName !== null) {
      group.name = row.shopName;
      entry.hasShopName = true;
    }
    group.campaigns.push(row);
    if (!advertiserIds.has(row.advertiserId)) {
      advertiserIds.add(row.advertiserId);
      group.advertisers.push({ id: row.advertiserId, name: row.advertiserName });
    }
    if (row.secondaryStatus === null) group.unknownStatusCount++;
    else if (row.secondaryStatus !== "CAMPAIGN_STATUS_ENABLE") group.warningCount++;
    if (group.uniformStatus !== row.secondaryStatus) group.uniformStatus = null;

    if (isCreatorEnrollment(row)) {
      const username = row.tiktokUsername.toLowerCase();
      if (!usernames.has(username)) {
        usernames.add(username);
        group.creatorEnrollments.push(row);
      }
    }
  }

  return Array.from(grouped.values(), ({ group }) => group);
}
