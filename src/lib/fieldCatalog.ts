import type {
  DimensionDescriptor,
  DimensionKey,
  FieldDescriptor,
  FieldKey,
  MetricDescriptor,
  MetricKey,
} from "@/types/report";

export const DIMENSIONS: readonly DimensionDescriptor[] = [
  { kind: "dimension", key: "storeId", label: "Store ID", minGrain: "campaign", format: "text" },
  { kind: "dimension", key: "storeName", label: "Store", minGrain: "campaign", format: "text" },
  { kind: "dimension", key: "itemGroupId", label: "Product ID", minGrain: "product", format: "text" },
  { kind: "dimension", key: "productName", label: "Product name", minGrain: "product", format: "text" },
  { kind: "dimension", key: "itemId", label: "Post ID", minGrain: "creative", format: "text" },
  { kind: "dimension", key: "title", label: "Creative", minGrain: "creative", format: "text" },
  { kind: "dimension", key: "ttAccountName", label: "TikTok display name", minGrain: "creative", format: "text" },
  { kind: "dimension", key: "ttAccountUsername", label: "TikTok username", minGrain: "creative", format: "text" },
  {
    kind: "dimension",
    key: "authorizationType",
    label: "Authorization type",
    minGrain: "creative",
    format: "text",
  },
  { kind: "dimension", key: "shopContentType", label: "Creative type", minGrain: "creative", format: "text" },
  {
    kind: "dimension",
    key: "creativeDeliveryStatus",
    label: "Delivery status",
    minGrain: "creative",
    format: "text",
  },
  { kind: "dimension", key: "campaignId", label: "Campaign ID", minGrain: "campaign", format: "text" },
  { kind: "dimension", key: "campaignName", label: "Campaign name", minGrain: "campaign", format: "text" },
];

export const METRICS: readonly MetricDescriptor[] = [
  // --- additive -----------------------------------------------------------
  {
    kind: "metric",
    key: "grossRevenue",
    label: "Gross revenue",
    aggregation: "sum",
    format: "currency",
    higherIsBetter: true,
  },
  { kind: "metric", key: "cost", label: "Cost", aggregation: "sum", format: "currency", higherIsBetter: false },
  { kind: "metric", key: "orders", label: "SKU orders", aggregation: "sum", format: "integer", higherIsBetter: true },
  {
    kind: "metric",
    key: "productImpressions",
    label: "Impressions",
    aggregation: "sum",
    format: "integer",
    higherIsBetter: true,
  },
  {
    kind: "metric",
    key: "productClicks",
    label: "Product clicks",
    aggregation: "sum",
    format: "integer",
    higherIsBetter: true,
  },

  // --- derived: recomputed from sums, never averaged ----------------------
  {
    kind: "metric",
    key: "roi",
    label: "ROI",
    aggregation: "derived",
    format: "ratio",
    formula: "SUM(Gross revenue) / SUM(Cost)",
    higherIsBetter: true,
  },
  {
    kind: "metric",
    key: "costPerOrder",
    label: "Cost per order",
    aggregation: "derived",
    format: "currency",
    formula: "SUM(Cost) / SUM(SKU orders)",
    higherIsBetter: false,
  },
  {
    kind: "metric",
    key: "ctr",
    label: "CTR",
    aggregation: "derived",
    format: "percent",
    formula: "SUM(Product clicks) / SUM(Impressions)",
    higherIsBetter: true,
  },
  {
    kind: "metric",
    key: "cvr",
    label: "CVR",
    aggregation: "derived",
    format: "percent",
    formula: "SUM(SKU orders) / SUM(Product clicks)",
    higherIsBetter: true,
  },
  {
    kind: "metric",
    key: "cpc",
    label: "CPC",
    aggregation: "derived",
    format: "currency",
    formula: "SUM(Cost) / SUM(Product clicks)",
    higherIsBetter: false,
  },
  {
    kind: "metric",
    key: "cpm",
    label: "CPM",
    aggregation: "derived",
    format: "currency",
    formula: "SUM(Cost) / SUM(Impressions) * 1000",
    higherIsBetter: false,
  },
  {
    kind: "metric",
    key: "aov",
    label: "Average order value",
    aggregation: "derived",
    format: "currency",
    formula: "SUM(Gross revenue) / SUM(SKU orders)",
    higherIsBetter: true,
  },

  // --- rate-only: weighted average, always approximate
  {
    kind: "metric",
    key: "productClickRate",
    label: "Product click rate",
    aggregation: "weightedAvg",
    weightBy: "productImpressions",
    format: "percent",
    approximate: true,
    higherIsBetter: true,
  },
];

const DIMENSION_BY_KEY = new Map<DimensionKey, DimensionDescriptor>(DIMENSIONS.map((d) => [d.key, d]));
const METRIC_BY_KEY = new Map<MetricKey, MetricDescriptor>(METRICS.map((m) => [m.key, m]));

export function getDimension(key: DimensionKey): DimensionDescriptor {
  const found = DIMENSION_BY_KEY.get(key);
  if (!found) throw new Error(`ไม่รู้จัก dimension: ${key}`);
  return found;
}

export function getMetric(key: MetricKey): MetricDescriptor {
  const found = METRIC_BY_KEY.get(key);
  if (!found) throw new Error(`ไม่รู้จัก metric: ${key}`);
  return found;
}

export function isMetricKey(key: FieldKey): key is MetricKey {
  return METRIC_BY_KEY.has(key as MetricKey);
}

export function isDimensionKey(key: FieldKey): key is DimensionKey {
  return DIMENSION_BY_KEY.has(key as DimensionKey);
}

export function getField(key: FieldKey): FieldDescriptor {
  return isMetricKey(key) ? getMetric(key) : getDimension(key);
}

export function fieldLabel(key: FieldKey): string {
  return getField(key).label;
}

/** The parts a derived metric is built from */
export const DERIVED_PARTS: Record<
  Extract<MetricKey, "roi" | "costPerOrder" | "ctr" | "cvr" | "cpc" | "cpm" | "aov">,
  { numerator: MetricKey; denominator: MetricKey; scale: number }
> = {
  roi: { numerator: "grossRevenue", denominator: "cost", scale: 1 },
  costPerOrder: { numerator: "cost", denominator: "orders", scale: 1 },
  ctr: { numerator: "productClicks", denominator: "productImpressions", scale: 100 },
  cvr: { numerator: "orders", denominator: "productClicks", scale: 100 },
  cpc: { numerator: "cost", denominator: "productClicks", scale: 1 },
  cpm: { numerator: "cost", denominator: "productImpressions", scale: 1000 },
  aov: { numerator: "grossRevenue", denominator: "orders", scale: 1 },
};

/** Metrics read straight off a `ReportRow`. Derived ones have no row-level column. */
export const RAW_METRIC_KEYS: readonly MetricKey[] = METRICS.filter(
  (m) => m.aggregation !== "derived",
).map((m) => m.key);
