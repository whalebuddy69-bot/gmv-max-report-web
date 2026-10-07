
/** Fact-table grain. Creative is the finest and the only one carrying video fields. */
export type Grain = "campaign" | "product" | "creative";

/** `shop_content_type`, separates real videos from the product card row. */
export type ShopContentType = "VIDEO" | "PRODUCT_CARD";

/** A store the service syncs, plus how fresh its data is. */
export interface StoreOption {
  storeId: string;
  storeName: string | null;
  advertiserId: string;
  enabled: boolean;
  /** ISO 8601 timestamp, or null if it has never synced. */
  lastSyncedAt: string | null;
  /** YYYY-MM-DD bounds of the data actually present, or null when there is none. */
  firstDate: string | null;
  lastDate: string | null;
}

export interface CampaignOption {
  campaignId: string;
  campaignName: string | null;
  cost: number | null;
}

/** One creative's totals for the selected range */
export interface ReportRow {
  storeId: string;
  /** Not on the wire; filled from the store list, like productName. */
  storeName: string | null;
  campaignId: string;
  campaignName: string | null;
  itemGroupId: string;
  productName: string | null;
  itemId: string;
  title: string | null;
  ttAccountName: string | null;
  ttAccountUsername: string | null;
  authorizationType: string | null;
  shopContentType: ShopContentType | null;
  creativeDeliveryStatus: string | null;
  /** Our sync timestamp, not the time TikTok changed this status. */
  creativeDeliveryStatusCheckedAt?: string | null;
  /** Source report date for the latest known status, independent of the metrics range. */
  creativeDeliveryStatusStatDate?: string | null;

  cost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  productImpressions: number | null;
  productClicks: number | null;
  productClickRate: number | null;
}

/** One product's totals for the range, from `/analytics/products`. */
export interface ProductRow {
  storeId: string;
  itemGroupId: string;
  productName: string | null;
  productStatus: string | null;
  /** Distinct campaigns that advertised this product in the range. */
  campaigns: number | null;
  cost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  costPerOrder: number | null;
}

/** One campaign's totals for the range, from `/analytics/campaigns`. */
export interface CampaignRow {
  storeId: string;
  campaignId: string;
  campaignName: string | null;
  /** Which GMV Max product this campaign belongs to. */
  promotionType: PromotionType;

  /* The creator the campaign runs for */
  identityId: string | null;
  ttAccountName: string | null;
  ttAccountProfileImageUrl: string | null;
  operationStatus: string | null;
  roasBid: number | null;
  cost: number | null;
  netCost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  costPerOrder: number | null;
}

/** The two GMV Max products, as TikTok's `filtering.gmv_max_promotion_types` names them */
export type PromotionType = "PRODUCT" | "LIVE";

/** One livestream, from `/analytics/live-rooms` */
export interface LiveRoomRow {
  storeId: string;
  campaignId: string;
  roomId: string;
  liveName: string | null;
  /** ONGOING | END, as TikTok sends it. */
  liveStatus: string | null;
  /** Kept as text, TikTok does not guarantee an ISO timestamp here. */
  liveLaunchedTime: string | null;
  /** Pre-formatted by TikTok, e.g. "14h 1m". */
  liveDuration: string | null;

  /* The service's split of the two fields above, plus the end of the stream */
  startDate: string | null;
  startTime: string | null;
  endTime: string | null;
  /** The service's `duration_seconds`, or parsed from `liveDuration` when it sends none. */
  durationSeconds: number | null;

  cost: number | null;
  netCost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  costPerOrder: number | null;

  liveViews: number | null;
  liveViews10s: number | null;
  costPerLiveView: number | null;
  costPerLiveView10s: number | null;
  liveFollows: number | null;
}

/** One creator's totals for the range, from `/analytics/creators`. */
export interface CreatorRow {
  ttAccountName: string;
  authorizationType: string | null;
  /** Distinct creatives and campaigns behind the totals. */
  creatives: number | null;
  campaigns: number | null;
  cost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  costPerOrder: number | null;
  productImpressions: number | null;
  productClicks: number | null;
  productClickRate: number | null;
}

/** One day of campaign-level totals, from `/analytics/timeseries`. */
export interface TimeseriesPoint {
  /** YYYY-MM-DD in the ad account's timezone. */
  statDate: string;
  cost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
}

/** One day of the "All" report, from `/analytics/all` */
export interface AllDayRow {
  /** YYYY-MM-DD in the ad account's timezone. */
  statDate: string;
  cost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  /** Same caveats as on SummaryTotals, which these are the daily form of. */
  totalVideos: number | null;
  videosWithSales: number | null;
  creatorsWithSales: number | null;
}

/** Campaign-grain totals from `/analytics/summary` */
export interface SummaryTotals {
  cost: number | null;
  netCost: number | null;
  orders: number | null;
  grossRevenue: number | null;
  roi: number | null;
  costPerOrder: number | null;
  /** Distinct campaigns with data in the range. */
  campaigns: number | null;

  /*
   * Video and creator counts, from `report_creative_daily` rather than the campaign table the
   * figures above come from
   */
  totalVideos: number | null;
  videosWithSales: number | null;
  creatorsWithSales: number | null;
}

export interface SummaryResponse {
  range: { from: string; to: string; days: number };
  previousRange: { from: string; to: string };
  current: SummaryTotals;
  /** Same-length window immediately before `range`, for the delta badges. */
  previous: SummaryTotals;
}

export interface CreativesResponse {
  rows: ReportRow[];
  /** Total matching creatives, for pagination. */
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ fields */

/** Every groupable column available on a `ReportRow`. */
export type DimensionKey =
  | "storeId"
  | "storeName"
  | "campaignId"
  | "campaignName"
  | "itemGroupId"
  | "productName"
  | "itemId"
  | "title"
  | "ttAccountName"
  | "ttAccountUsername"
  | "authorizationType"
  | "shopContentType"
  | "creativeDeliveryStatus";

/** Metrics that can be summed straight from row values. */
export type AdditiveMetricKey = "cost" | "orders" | "grossRevenue" | "productImpressions" | "productClicks";

/** Metrics computed from sums */
export type DerivedMetricKey = "roi" | "costPerOrder" | "ctr" | "cvr" | "cpc" | "cpm" | "aov";

/** Percentages the service returns per row with no denominator exposed */
export type RateMetricKey = "productClickRate";

export type MetricKey = AdditiveMetricKey | DerivedMetricKey | RateMetricKey;

export type FieldKey = DimensionKey | MetricKey;

/** How a cell's number should be rendered and written into Excel. */
export type ValueFormat = "integer" | "currency" | "percent" | "ratio" | "decimal" | "text";

export interface DimensionDescriptor {
  kind: "dimension";
  key: DimensionKey;
  label: string;
  /** Lowest grain that carries this column; drives "not available here" states. */
  minGrain: Grain;
  format: "text";
}

export interface MetricDescriptor {
  kind: "metric";
  key: MetricKey;
  label: string;
  aggregation: "sum" | "derived" | "weightedAvg";
  format: ValueFormat;
  /** Populated for `derived`, shown as a tooltip so a user can check the math. */
  formula?: string;
  /** Populated for `weightedAvg`, the additive metric used as the weight. */
  weightBy?: AdditiveMetricKey;
  /** Rolled-up value is an approximation; render with a ≈ badge. */
  approximate?: boolean;
  higherIsBetter: boolean;
}

export type FieldDescriptor = DimensionDescriptor | MetricDescriptor;

/* ------------------------------------------------------------------- query */

export type SortDirection = "asc" | "desc";

/** Columns `/analytics/creatives` will actually sort by */
export const CREATIVE_SORT_KEYS = [
  "cost",
  "orders",
  "grossRevenue",
  "roi",
  "productImpressions",
  "productClicks",
] as const satisfies readonly MetricKey[];

export type CreativeSortKey = (typeof CREATIVE_SORT_KEYS)[number];

export function isCreativeSortKey(key: string): key is CreativeSortKey {
  return (CREATIVE_SORT_KEYS as readonly string[]).includes(key);
}

/** One entry in the Live creator picker, from `/analytics/creator-options`. */
export interface CreatorOption {
  identityId: string;
  ttAccountName: string | null;
  cost: number | null;
}

export interface RangeQuery {
  /** Empty means every store. The service takes these comma-separated. */
  storeIds?: string[];
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  campaignId?: string;
  itemGroupId?: string;
  /** Which GMV Max product to count */
  promotionType?: PromotionType;
  /** TikTok's identity_id */
  identityId?: string;
}

export interface CreativesQuery extends RangeQuery {
  accountName?: string;
  contentType?: ShopContentType;
  sort?: CreativeSortKey;
  direction?: SortDirection;
  /** The service caps this at 1000. */
  limit?: number;
  offset?: number;
}

/** Grand totals over a row set. */
export type MetricTotals = Partial<Record<MetricKey, number | null>>;
