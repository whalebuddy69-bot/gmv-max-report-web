import type {
  AllDayRow,
  CampaignOption,
  CampaignRow,
  CreativesQuery,
  CreativesResponse,
  CreatorOption,
  CreatorRow,
  LiveRoomRow,
  ProductRow,
  RangeQuery,
  ReportRow,
  StoreOption,
  SummaryResponse,
  TimeseriesPoint,
} from "@/types/report";
import type { AuthorizeLink, StoreAuthorizationResult } from "@/types/storeAuth";
import { http, request } from "./client";
import { parseDurationLabel } from "@/lib/format";
import {
  campaignOptionsResponseSchema,
  campaignsResponseSchema,
  creativesResponseSchema,
  creatorsResponseSchema,
  productsResponseSchema,
  storesResponseSchema,
  storeAuthorizationResponseSchema,
  authorizeLinkResponseSchema,
  liveRoomsResponseSchema,
  creatorOptionsResponseSchema,
  allDaysResponseSchema,
  summaryResponseSchema,
  timeseriesResponseSchema,
} from "./schemas";

function rangeParams(query: RangeQuery): Record<string, string> {
  const params: Record<string, string> = { from: query.from, to: query.to };
  // Comma-separated; omitted entirely when empty, which the service reads as "all".
  if (query.storeIds?.length) params.storeId = query.storeIds.join(",");
  if (query.campaignId) params.campaignId = query.campaignId;
  if (query.itemGroupId) params.itemGroupId = query.itemGroupId;
  return params;
}

/** The range plus `promotionType`, for the four campaign-grain endpoints that accept it */
function campaignScopeParams(query: RangeQuery): Record<string, string> {
  return { ...liveScopeParams(query), promotionType: query.promotionType ?? "PRODUCT" };
}

/**
 * The range plus `identityId`, for the two endpoints that filter on a Live creator:
 * /analytics/campaigns and /analytics/live-rooms
 */
function liveScopeParams(query: RangeQuery): Record<string, string> {
  const params = rangeParams(query);
  if (query.identityId) params.identityId = query.identityId;
  return params;
}

export async function fetchStores(): Promise<StoreOption[]> {
  const data = await request(storesResponseSchema, "/analytics/stores", () =>
    http.get("/analytics/stores"),
  );
  return data.stores.map((s) => ({
    storeId: s.store_id,
    storeName: s.store_name,
    advertiserId: s.advertiser_id,
    enabled: s.enabled,
    lastSyncedAt: s.last_synced_at,
    firstDate: s.first_date,
    lastDate: s.last_date,
  }));
}

export async function fetchCampaignOptions(query: RangeQuery): Promise<CampaignOption[]> {
  const data = await request(campaignOptionsResponseSchema, "/analytics/campaign-options", () =>
    http.get("/analytics/campaign-options", { params: campaignScopeParams(query) }),
  );
  return data.campaigns.map((c) => ({
    campaignId: c.campaign_id,
    campaignName: c.campaign_name,
    cost: c.cost,
  }));
}

export async function fetchSummary(query: RangeQuery): Promise<SummaryResponse> {
  const data = await request(summaryResponseSchema, "/analytics/summary", () =>
    http.get("/analytics/summary", { params: campaignScopeParams(query) }),
  );

  const toTotals = (t: (typeof data)["current"]) => ({
    cost: t.cost,
    netCost: t.net_cost,
    orders: t.orders,
    grossRevenue: t.gross_revenue,
    roi: t.roi,
    costPerOrder: t.cost_per_order,
    campaigns: t.campaigns,
    totalVideos: t.total_videos,
    videosWithSales: t.videos_with_sales,
    creatorsWithSales: t.creators_with_sales,
  });

  return {
    range: data.range,
    previousRange: data.previousRange,
    current: toTotals(data.current),
    previous: toTotals(data.previous),
  };
}

export async function fetchTimeseries(query: RangeQuery): Promise<TimeseriesPoint[]> {
  const data = await request(timeseriesResponseSchema, "/analytics/timeseries", () =>
    http.get("/analytics/timeseries", { params: campaignScopeParams(query) }),
  );
  return data.points.map((p) => ({
    statDate: p.stat_date,
    cost: p.cost,
    orders: p.orders,
    grossRevenue: p.gross_revenue,
    roi: p.roi,
  }));
}

/** The summary cards, one row per day */
export async function fetchAllDays(query: RangeQuery): Promise<AllDayRow[]> {
  const data = await request(allDaysResponseSchema, "/analytics/all", () =>
    http.get("/analytics/all", { params: campaignScopeParams(query) }),
  );
  return data.days.map((d) => ({
    statDate: d.stat_date,
    cost: d.cost,
    orders: d.orders,
    grossRevenue: d.gross_revenue,
    roi: d.roi,
    totalVideos: d.total_videos,
    videosWithSales: d.videos_with_sales,
    creatorsWithSales: d.creators_with_sales,
  }));
}

export async function fetchCampaigns(
  query: RangeQuery & { sort?: string; direction?: "asc" | "desc" },
): Promise<CampaignRow[]> {
  const params = campaignScopeParams(query);
  if (query.sort) params.sort = toWireSort(query.sort);
  if (query.direction) params.direction = query.direction.toUpperCase();

  const data = await request(campaignsResponseSchema, "/analytics/campaigns", () =>
    http.get("/analytics/campaigns", { params }),
  );
  return data.campaigns.map((c) => ({
    storeId: c.store_id,
    campaignId: c.campaign_id,
    campaignName: c.campaign_name,
    promotionType: c.promotion_type,
    identityId: c.identity_id,
    ttAccountName: c.tt_account_name,
    ttAccountProfileImageUrl: c.tt_account_profile_image_url,
    operationStatus: c.operation_status,
    roasBid: c.roas_bid,
    cost: c.cost,
    netCost: c.net_cost,
    orders: c.orders,
    grossRevenue: c.gross_revenue,
    roi: c.roi,
    costPerOrder: c.cost_per_order,
  }));
}

/** Creators to pick from on the Live tab */
export async function fetchCreatorOptions(query: RangeQuery): Promise<CreatorOption[]> {
  const data = await request(creatorOptionsResponseSchema, "/analytics/creator-options", () =>
    http.get("/analytics/creator-options", { params: rangeParams(query) }),
  );
  return data.creators.map((c) => ({
    identityId: c.identity_id,
    ttAccountName: c.tt_account_name,
    cost: c.cost,
  }));
}

export async function fetchLiveRooms(query: RangeQuery): Promise<LiveRoomRow[]> {
  const data = await request(liveRoomsResponseSchema, "/analytics/live-rooms", () =>
    http.get("/analytics/live-rooms", { params: liveScopeParams(query) }),
  );
  return data.liveRooms.map((r) => ({
    storeId: r.store_id,
    campaignId: r.campaign_id,
    roomId: r.room_id,
    liveName: r.live_name,
    liveStatus: r.live_status,
    liveLaunchedTime: r.live_launched_time,
    liveDuration: r.live_duration,
    startDate: r.start_date,
    startTime: r.start_time,
    endTime: r.end_time,
    // The service's own number when it sends one, else read off the label it derives that
    // number from
    durationSeconds: r.duration_seconds ?? parseDurationLabel(r.live_duration),
    cost: r.cost,
    netCost: r.net_cost,
    orders: r.orders,
    grossRevenue: r.gross_revenue,
    roi: r.roi,
    costPerOrder: r.cost_per_order,
    liveViews: r.live_views,
    liveViews10s: r.live_views_10s,
    costPerLiveView: r.cost_per_live_view,
    costPerLiveView10s: r.cost_per_live_view_10s,
    liveFollows: r.live_follows,
  }));
}

export async function fetchProducts(query: RangeQuery): Promise<ProductRow[]> {
  const data = await request(productsResponseSchema, "/analytics/products", () =>
    http.get("/analytics/products", { params: rangeParams(query) }),
  );
  return data.products.map((p) => ({
    storeId: p.store_id,
    itemGroupId: p.item_group_id,
    productName: p.product_name,
    productStatus: p.product_status,
    campaigns: p.campaigns,
    cost: p.cost,
    orders: p.orders,
    grossRevenue: p.gross_revenue,
    roi: p.roi,
    costPerOrder: p.cost_per_order,
  }));
}

export async function fetchCreators(
  query: RangeQuery & { minCost?: number },
): Promise<CreatorRow[]> {
  const params = rangeParams(query);
  if (query.minCost !== undefined) params.minCost = String(query.minCost);

  const data = await request(creatorsResponseSchema, "/analytics/creators", () =>
    http.get("/analytics/creators", { params }),
  );
  return data.creators.map((c) => ({
    ttAccountName: c.tt_account_name,
    authorizationType: c.authorization_type,
    creatives: c.creatives,
    campaigns: c.campaigns,
    cost: c.cost,
    orders: c.orders,
    grossRevenue: c.gross_revenue,
    roi: c.roi,
    costPerOrder: c.cost_per_order,
    productImpressions: c.product_impressions,
    productClicks: c.product_clicks,
    productClickRate: c.product_click_rate,
  }));
}

/** camelCase metric keys back to the column names the service's allowlist expects. */
const SORT_TO_WIRE: Record<string, string> = {
  grossRevenue: "gross_revenue",
  productImpressions: "product_impressions",
  productClicks: "product_clicks",
  costPerOrder: "cost_per_order",
  campaignName: "campaign_name",
};

function toWireSort(key: string): string {
  return SORT_TO_WIRE[key] ?? key;
}

/** The main report table */
export async function fetchCreatives(query: CreativesQuery): Promise<CreativesResponse> {
  const params = rangeParams(query);
  if (query.accountName) params.accountName = query.accountName;
  if (query.contentType) params.contentType = query.contentType;
  if (query.sort) params.sort = toWireSort(query.sort);
  if (query.direction) params.direction = query.direction.toUpperCase();
  if (query.limit !== undefined) params.limit = String(query.limit);
  if (query.offset !== undefined) params.offset = String(query.offset);

  const data = await request(creativesResponseSchema, "/analytics/creatives", () =>
    http.get("/analytics/creatives", { params }),
  );

  const rows: ReportRow[] = data.creatives.map((c) => ({
    storeId: c.store_id,
    // Filled by withStoreNames() from the store list the picker already loaded.
    storeName: null,
    campaignId: c.campaign_id,
    campaignName: c.campaign_name,
    itemGroupId: c.item_group_id,
    // Not returned by this endpoint; filled in by the caller from the products list.
    productName: null,
    itemId: c.item_id,
    title: c.title,
    ttAccountName: c.tt_account_name,
    ttAccountUsername: c.tt_account_username,
    authorizationType: c.authorization_type,
    shopContentType: c.shop_content_type,
    creativeDeliveryStatus: c.creative_delivery_status,
    cost: c.cost,
    orders: c.orders,
    grossRevenue: c.gross_revenue,
    roi: c.roi,
    productImpressions: c.product_impressions,
    productClicks: c.product_clicks,
    productClickRate: c.product_click_rate,
  }));

  return { rows, total: data.total, limit: data.limit, offset: data.offset };
}

/** Fills `productName` from the products list */
export function withProductNames(rows: readonly ReportRow[], products: readonly ProductRow[]): ReportRow[] {
  if (products.length === 0) return rows as ReportRow[];
  const names = new Map(products.map((p) => [p.itemGroupId, p.productName]));
  return rows.map((row) => ({ ...row, productName: names.get(row.itemGroupId) ?? null }));
}

/** Which shops can be pulled and why the rest cannot */
export function fetchStoreAuthorization(refresh = false): Promise<StoreAuthorizationResult> {
  return request(storeAuthorizationResponseSchema, "/analytics/store-authorization", () =>
    http.get("/analytics/store-authorization", { params: refresh ? { refresh: "1" } : undefined }),
  );
}

/** Mints a TikTok consent link for one ad account */
export function createAuthorizeLink(
  targetAdvertiserId: string,
  storeId?: string,
): Promise<AuthorizeLink> {
  const path = "/analytics/store-authorization/authorize-link";
  return request(authorizeLinkResponseSchema, path, () =>
    http.post(path, { targetAdvertiserId, storeId }),
  );
}

/** Fills `storeName` from the store list */
export function withStoreNames(
  rows: readonly ReportRow[],
  stores: readonly StoreOption[],
): ReportRow[] {
  if (stores.length === 0) return rows as ReportRow[];
  const names = new Map(stores.map((s) => [s.storeId, s.storeName]));
  return rows.map((row) => ({ ...row, storeName: names.get(row.storeId) ?? null }));
}

/** The service's Zod schema caps `limit` at 1000, so this is the largest page it takes. */
export const MAX_PAGE_SIZE = 1000;

/** Every creative matching the query, fetched a page at a time */
export async function fetchAllCreatives(
  query: Omit<CreativesQuery, "limit" | "offset">,
  options: { hardLimit?: number; onProgress?: (fetched: number, total: number) => void } = {},
): Promise<CreativesResponse> {
  const hardLimit = options.hardLimit ?? 50_000;

  const first = await fetchCreatives({ ...query, limit: MAX_PAGE_SIZE, offset: 0 });
  const rows = [...first.rows];
  const target = Math.min(first.total, hardLimit);
  options.onProgress?.(rows.length, target);

  while (rows.length < target) {
    const page = await fetchCreatives({ ...query, limit: MAX_PAGE_SIZE, offset: rows.length });
    rows.push(...page.rows);
    options.onProgress?.(Math.min(rows.length, target), target);

    // A page shorter than the limit is the last one by definition
    if (page.rows.length < MAX_PAGE_SIZE) break;
  }

  return { rows: rows.slice(0, hardLimit), total: first.total, limit: MAX_PAGE_SIZE, offset: 0 };
}
