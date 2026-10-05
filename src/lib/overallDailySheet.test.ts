import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { AllDayRow, SummaryTotals } from "@/types/report";
import { buildSheet } from "./exportExcel";
import { datesInRange, overallDailySheet } from "./overallDailySheet";

const day = (over: Partial<AllDayRow> = {}): AllDayRow => ({
  statDate: "2026-10-01", cost: 100, orders: 10, grossRevenue: 300, roi: 3,
  totalVideos: 10, videosWithSales: 4, creatorsWithSales: 3, ...over,
});
const totals: SummaryTotals = {
  cost: 1000, netCost: 980, orders: 30, grossRevenue: 1200, roi: 1.2, costPerOrder: 1000 / 30,
  campaigns: 8, totalVideos: 15, videosWithSales: 6, creatorsWithSales: 4,
};
const options = {
  days: [day({ statDate: "2026-10-03", cost: 900, orders: 20, grossRevenue: 900, roi: 1 }), day()],
  totals, range: { from: "2026-10-01", to: "2026-10-10", promotionType: "PRODUCT" as const },
  storeLabel: "Sample shop", today: "2026-10-05",
};

describe("datesInRange", () => {
  it("includes both boundaries and preserves leap/month/year transitions", () => {
    expect(datesInRange("2026-10-01", "2026-10-10")).toHaveLength(10);
    expect(datesInRange("2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
    expect(datesInRange("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(datesInRange("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  });
  it.each([["2026-02-29", "2026-03-01"], ["invalid", "2026-10-05"], ["2026-10-05", "2026-10-01"]])("rejects invalid range %s – %s", (from, to) => {
    expect(() => datesInRange(from, to)).toThrow();
  });
});

describe("overallDailySheet", () => {
  it("exports exactly ten ordered dates and Total, even with sparse API rows", () => {
    const result = overallDailySheet(options);
    expect(result.rows).toHaveLength(11);
    expect(result.rows.slice(0, 10).map((r) => r.statDate)).toEqual(datesInRange("2026-10-01", "2026-10-10"));
    expect(result.rows[1]).toMatchObject({ statDate: "2026-10-02", cost: null, orders: null, status: "ไม่มีข้อมูลในระบบ" });
    expect(result.rows[5]).toMatchObject({ statDate: "2026-10-06", cost: null, status: "ยังไม่ถึงวันที่รายงาน" });
    expect(result.rows.at(-1)).toMatchObject({ statDate: "Total", cost: 1000, orders: 30, grossRevenue: 1200 });
  });

  it("uses distinct whole-period video/creator counts, not the sum of daily counts", () => {
    const total = overallDailySheet(options).rows.at(-1)!;
    expect(total.totalVideos).toBe(15); // daily counts add to 20
    expect(total.videosWithSales).toBe(6); // daily counts add to 8
    expect(total.creatorsWithSales).toBe(4); // daily counts add to 6
    expect(total.status).toContain("นับไม่ซ้ำทั้งช่วง");
    expect(total.status).toContain("2/10 วัน");
  });

  it("round-trips real dates, numbers, total formulas and ratios of sums", () => {
    const result = overallDailySheet(options);
    const sheet = buildSheet(result.rows, result.columns, { sheetName: result.name, subtitle: result.subtitle });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, result.name);
    const reopened = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellNF: true }).Sheets[result.name]!;
    expect(reopened.A4).toMatchObject({ t: "n", z: "yyyy-mm-dd", w: "2026-10-01" });
    expect(reopened.A13.w).toBe("2026-10-10");
    expect(reopened.A14.v).toBe("Total");
    expect(reopened.B14).toMatchObject({ t: "n", v: 1000, f: 'IF(COUNT(B4:B13)=0,"",SUM(B4:B13))' });
    expect(reopened.C14.v).toBe(30);
    expect(reopened.D14.v).toBe(1200);
    expect(reopened.E14.v).toBeCloseTo(1.2); // not SUM(3+1), nor AVERAGE(3,1)
    expect(reopened.F14.v).toBeCloseTo(1000 / 30);
    expect(reopened.G14).toMatchObject({ t: "n", v: 15 });
    expect(reopened.G14.f).toBeUndefined();
    expect(reopened.B5?.v ?? null).toBeNull();
    expect(reopened.E5.f).toContain('ISNUMBER');
    expect(reopened.E5.v).toBe("");
  });

  it("keeps real zeros and computes zero cost per order when there are orders", () => {
    const result = overallDailySheet({ ...options, days: [day({ cost: 0, orders: 5, grossRevenue: 20 })] });
    const sheet = buildSheet(result.rows, result.columns, { sheetName: result.name });
    expect(sheet.B2.v).toBe(0);
    expect(sheet.F2.v).toBe(0);
    expect(sheet.E2.v).toBe("");
  });

  it("does not invent zero totals when no source days exist", () => {
    const result = overallDailySheet({ ...options, days: [] });
    expect(result.rows.at(-1)).toMatchObject({ cost: null, orders: null, grossRevenue: null, totalVideos: null });
    const sheet = buildSheet(result.rows, result.columns, { sheetName: result.name });
    expect(sheet.B12).toMatchObject({ v: "", f: 'IF(COUNT(B2:B11)=0,"",SUM(B2:B11))' });
  });

  it("labels today as partial without changing the values", () => {
    const result = overallDailySheet({ ...options, days: [day({ statDate: "2026-10-05" })] });
    expect(result.rows[4]).toMatchObject({ cost: 100, status: "ข้อมูลระหว่างวัน (ยังไม่จบวัน)" });
  });

  it("flags a partially populated source row and keeps the missing values blank", () => {
    const result = overallDailySheet({ ...options, days: [day({ totalVideos: null, grossRevenue: null })] });
    expect(result.rows[0]).toMatchObject({ totalVideos: null, grossRevenue: null, status: "ข้อมูลบางตัวชี้วัดไม่ครบ" });
    expect(result.rows.at(-1)?.grossRevenue).toBeNull();
  });

  it("omits Product content metrics from LIVE, preserving financial metrics", () => {
    const result = overallDailySheet({ ...options, range: { ...options.range, promotionType: "LIVE" }, creatorLabel: "LIVE Creator: id-1" });
    expect(result.columns.map((c) => c.header)).toEqual(["Date", "Cost", "SKU orders", "Gross revenue", "ROI", "Cost per order", "Data status"]);
    expect(result.subtitle).toContain("LIVE Creator: id-1");
    expect(result.rows.at(-1)?.status).not.toContain("วิดีโอ");
  });

  it("rejects duplicate dates and does not include out-of-range data in Total", () => {
    expect(() => overallDailySheet({ ...options, days: [day(), day()] })).toThrow("ซ้ำ");
    const result = overallDailySheet({ ...options, days: [day(), day({ statDate: "2026-09-30", cost: 9000 })] });
    expect(result.rows.at(-1)?.cost).toBe(100);
  });
});
