import { describe, expect, it } from "vitest";
import type { ReportRow } from "@/types/report";
import type { AnalysisConfig } from "@/types/analysis";
import { applyFilters, computePivot } from "./pivotEngine";
import { aggregateMetric, computeTotals } from "./aggregate";
import { TOTAL_COLUMN_KEY, cellKey } from "./pivotKeys";

function row(overrides: Partial<ReportRow>): ReportRow {
  return {
    storeId: "store-1",
    storeName: "Store One",
    campaignId: "camp-1",
    campaignName: "Campaign 1",
    itemGroupId: "prod-1",
    productName: "Product 1",
    itemId: "vid-1",
    title: "Video 1",
    ttAccountName: "creator.a",
    ttAccountUsername: "creator.a",
    authorizationType: null,
    shopContentType: "VIDEO",
    creativeDeliveryStatus: null,
    cost: 0,
    orders: 0,
    grossRevenue: 0,
    roi: null,
    productImpressions: 0,
    productClicks: 0,
    productClickRate: null,
    ...overrides,
  };
}

const baseConfig: AnalysisConfig = {
  rows: [],
  columns: [],
  values: [],
  filters: [],
  chartType: "table",
};

describe("aggregateMetric", () => {
  it("recomputes ROI from summed parts rather than averaging per-row ROI", () => {
    // Per-row ROIs are 10 and 1
    const rows = [
      row({ grossRevenue: 1000, cost: 100, roi: 10 }),
      row({ grossRevenue: 100, cost: 900, roi: 0.111 }),
    ];

    // Mean of per-row ROI would be ~5.06; the correct answer is 1100/1000.
    expect(aggregateMetric(rows, "roi")).toBeCloseTo(1.1, 6);
  });

  it("returns null for ROI when total cost is zero instead of Infinity", () => {
    const rows = [row({ grossRevenue: 500, cost: 0 })];
    expect(aggregateMetric(rows, "roi")).toBeNull();
  });

  it("weights rate metrics by impressions instead of summing them", () => {
    const rows = [
      row({ productClickRate: 10, productImpressions: 1000 }),
      row({ productClickRate: 2, productImpressions: 9000 }),
    ];

    // Plain mean would be 6; impression-weighted is (10*1000 + 2*9000)/10000 = 2.8.
    expect(aggregateMetric(rows, "productClickRate")).toBeCloseTo(2.8, 6);
  });

  it("falls back to an unweighted mean when every weight is zero", () => {
    const rows = [
      row({ productClickRate: 10, productImpressions: 0 }),
      row({ productClickRate: 20, productImpressions: 0 }),
    ];
    expect(aggregateMetric(rows, "productClickRate")).toBeCloseTo(15, 6);
  });

  it("computes CTR as clicks over impressions across the whole group", () => {
    const rows = [
      row({ productClicks: 50, productImpressions: 1000 }),
      row({ productClicks: 150, productImpressions: 3000 }),
    ];
    expect(aggregateMetric(rows, "ctr")).toBeCloseTo(5, 6);
  });

  it("reports null, not zero, when no row carries the metric", () => {
    const rows = [row({ productImpressions: null })];
    expect(aggregateMetric(rows, "productImpressions")).toBeNull();
  });
});

describe("computeTotals", () => {
  it("covers every metric in the catalog", () => {
    const totals = computeTotals([row({ grossRevenue: 100, cost: 50, orders: 2 })]);
    expect(totals.grossRevenue).toBe(100);
    expect(totals.roi).toBeCloseTo(2, 6);
    expect(totals.aov).toBeCloseTo(50, 6);
  });
});

describe("applyFilters", () => {
  it("excludes rows whose metric is null from a numeric comparison", () => {
    const rows = [row({ grossRevenue: 5000 }), row({ grossRevenue: null })];
    const filtered = applyFilters(rows, [
      { id: "f1", field: "grossRevenue", operator: "gt", value: 1000 },
    ]);
    expect(filtered).toHaveLength(1);
  });

  it("matches a dimension against a list", () => {
    const rows = [row({ ttAccountName: "a" }), row({ ttAccountName: "b" })];
    const filtered = applyFilters(rows, [
      { id: "f1", field: "ttAccountName", operator: "in", value: ["b"] },
    ]);
    expect(filtered[0]?.ttAccountName).toBe("b");
  });

  it("treats a null creator as matching isNull", () => {
    const rows = [row({ ttAccountName: null }), row({ ttAccountName: "a" })];
    const filtered = applyFilters(rows, [
      { id: "f1", field: "ttAccountName", operator: "isNull", value: null },
    ]);
    expect(filtered).toHaveLength(1);
  });

  it("applies every condition, not just the first", () => {
    const rows = [
      row({ grossRevenue: 5000, orders: 1 }),
      row({ grossRevenue: 5000, orders: 40 }),
    ];
    const filtered = applyFilters(rows, [
      { id: "f1", field: "grossRevenue", operator: "gte", value: 1000 },
      { id: "f2", field: "orders", operator: "gt", value: 10 },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.orders).toBe(40);
  });
});

describe("computePivot", () => {
  const rows = [
    row({ ttAccountName: "a", campaignName: "2026-08-01", grossRevenue: 100, cost: 50, orders: 1 }),
    row({ ttAccountName: "a", campaignName: "2026-08-02", grossRevenue: 300, cost: 100, orders: 3 }),
    row({ ttAccountName: "b", campaignName: "2026-08-01", grossRevenue: 200, cost: 200, orders: 2 }),
  ];

  it("groups by a row dimension and sums the value field", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
    });

    expect(pivot.rows).toHaveLength(2);
    const creatorA = pivot.rows.find((r) => r.rowKey[0] === "a");
    expect(creatorA?.cells[cellKey(TOTAL_COLUMN_KEY, "v1")]?.value).toBe(400);
  });

  it("builds a cross-tab when rows and columns are both set", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      columns: [{ id: "c1", dimension: "campaignName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
    });

    expect(pivot.columnGroups.map((g) => g.path[0])).toEqual(["2026-08-01", "2026-08-02"]);
    const creatorA = pivot.rows.find((r) => r.rowKey[0] === "a");
    expect(creatorA?.cells[cellKey("2026-08-02", "v1")]?.value).toBe(300);
  });

  it("leaves an empty cell null rather than zero", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      columns: [{ id: "c1", dimension: "campaignName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
    });

    // Creator b has no row on 2026-08-02.
    const creatorB = pivot.rows.find((r) => r.rowKey[0] === "b");
    const cell = creatorB?.cells[cellKey("2026-08-02", "v1")];
    expect(cell?.value).toBeNull();
    expect(cell?.rowCount).toBe(0);
  });

  it("computes column subtotals from rows, not by adding up cell ROIs", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      columns: [{ id: "c1", dimension: "campaignName" }],
      values: [{ id: "v1", metric: "roi", aggregation: "SUM" }],
    });

    // 2026-08-01: revenue 100+200=300, cost 50+200=250 -> 1.2
    expect(pivot.columnTotals[cellKey("2026-08-01", "v1")]?.value).toBeCloseTo(1.2, 6);
  });

  it("gives a grand total over every filtered row", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
    });
    expect(pivot.grandTotals.v1?.value).toBe(600);
  });

  it("counts rows rather than values for COUNT", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "COUNT" }],
    });
    const creatorA = pivot.rows.find((r) => r.rowKey[0] === "a");
    expect(creatorA?.cells[cellKey(TOTAL_COLUMN_KEY, "v1")]?.value).toBe(2);
  });

  it("returns an empty result when no value field is placed", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
    });
    expect(pivot.rows).toEqual([]);
    expect(pivot.matchedRows).toBe(3);
  });

  it("keeps a null dimension as its own group instead of dropping the rows", () => {
    const withNull = [...rows, row({ ttAccountName: null, grossRevenue: 999 })];
    const pivot = computePivot(withNull, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
    });

    expect(pivot.rows).toHaveLength(3);
    const unknown = pivot.rows.find((r) => r.rowKey[0] === "");
    expect(unknown?.cells[cellKey(TOTAL_COLUMN_KEY, "v1")]?.value).toBe(999);
  });

  it("applies filters before aggregating", () => {
    const pivot = computePivot(rows, {
      ...baseConfig,
      rows: [{ id: "r1", dimension: "ttAccountName" }],
      values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
      filters: [{ id: "f1", field: "grossRevenue", operator: "gt", value: 150 }],
    });

    expect(pivot.matchedRows).toBe(2);
    const creatorA = pivot.rows.find((r) => r.rowKey[0] === "a");
    expect(creatorA?.cells[cellKey(TOTAL_COLUMN_KEY, "v1")]?.value).toBe(300);
  });
});
