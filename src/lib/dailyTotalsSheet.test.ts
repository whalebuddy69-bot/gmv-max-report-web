import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { AllDayRow } from "@/types/report";
import { dailyTotalsColumns } from "./dailyTotalsSheet";
import { buildSheet } from "./exportExcel";

function day(over: Partial<AllDayRow> = {}): AllDayRow {
  return {
    statDate: "2026-09-02",
    cost: 6133.5,
    orders: 137,
    grossRevenue: 41_090,
    roi: 6.7,
    totalVideos: 12,
    videosWithSales: 4,
    creatorsWithSales: 3,
    ...over,
  };
}

const headers = (content: boolean) => dailyTotalsColumns({ content }).map((c) => c.header);

describe("dailyTotalsColumns", () => {
  it("carries the money columns on both tabs", () => {
    expect(headers(false)).toEqual([
      "stat_date",
      "cost",
      "orders",
      "gross_revenue",
      "roi",
      "cost_per_order",
    ]);
  });

  it("appends the content counts only where they are in scope", () => {
    // The creative table has no promotion_type column, so these are Product figures whatever
    // the tab says
    expect(headers(true).slice(6)).toEqual([
      "videos_advertised",
      "videos_with_sales",
      "creators_with_sales",
    ]);
    expect(headers(false)).toHaveLength(6);
  });

  it("recomputes cost per order from the row rather than reading a field", () => {
    const [column] = dailyTotalsColumns({ content: false }).filter(
      (c) => c.header === "cost_per_order",
    );
    expect(column!.value(day())).toBeCloseTo(6133.5 / 137, 6);
  });

  it("leaves cost per order empty on a day with no orders", () => {
    // Not 0: a day that spent nothing and sold nothing has no cost per order, and a zero would
    // drag any average a reader takes down the column
    const [column] = dailyTotalsColumns({ content: false }).filter(
      (c) => c.header === "cost_per_order",
    );
    expect(column!.value(day({ orders: 0 }))).toBeNull();
    expect(column!.value(day({ cost: null, orders: null }))).toBeNull();
  });

  it("writes stat_date as a real date cell, not a string", () => {
    const columns = dailyTotalsColumns({ content: true });
    const sheet = buildSheet([day()], columns, { sheetName: "All" });
    const cell = sheet.A2 as XLSX.CellObject;
    expect(cell.t).toBe("n");
    expect(cell.z).toBe("yyyy-mm-dd");
    // 2026-09-02 as a serial, counted from Excel's 1899-12-30 epoch and checked against the
    // known anchor 2021-01-01 = 44197
    expect(cell.v).toBe(46267);
  });

  it("keeps a missing count empty rather than calling it zero", () => {
    // A service deployed before these columns existed sends nothing, which reaches here as null
    const columns = dailyTotalsColumns({ content: true });
    const sheet = buildSheet([day({ totalVideos: null })], columns, { sheetName: "All" });
    expect((sheet.G2 as XLSX.CellObject | undefined)?.v ?? null).toBeNull();
  });
});
