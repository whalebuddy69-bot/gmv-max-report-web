import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { PivotResult } from "@/types/analysis";
import { buildSheet, makeFileName, pivotToSheet, type ExportColumn } from "./exportExcel";
import { TOTAL_COLUMN_KEY, cellKey } from "./pivotKeys";

interface Sample {
  name: string;
  gmv: number | null;
  ctr: number | null;
}

const rows: Sample[] = [
  { name: "creator.a", gmv: 1234.5, ctr: 3.88 },
  { name: "=cmd|calc", gmv: null, ctr: 0 },
];

const columns: ExportColumn<Sample>[] = [
  { header: "Creator", format: "text", value: (r) => r.name },
  { header: "GMV", format: "currency", value: (r) => r.gmv },
  { header: "CTR", format: "percent", value: (r) => r.ctr },
];

describe("buildSheet", () => {
  it("writes metrics as numbers, not preformatted text", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test" });
    const cell = sheet.B2 as XLSX.CellObject;
    expect(cell.t).toBe("n");
    expect(cell.v).toBe(1234.5);
  });

  it("attaches a number format per column type", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test" });
    expect((sheet.B2 as XLSX.CellObject).z).toBe('#,##0.00" ฿"');
    expect((sheet.C2 as XLSX.CellObject).z).toBe('#,##0.00"%"');
  });

  it("freezes the header row", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test" });
    expect(sheet["!panes"]).toEqual([
      { pane: "bottomLeft", ySplit: 1, state: "frozen", topLeftCell: "A2" },
    ]);
  });

  it("sets a width for every column", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test" });
    expect(sheet["!cols"]).toHaveLength(3);
    expect((sheet["!cols"] as { wch: number }[])[0]!.wch).toBeGreaterThan(8);
  });

  it("neutralizes a leading = so Excel does not treat text as a formula", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test" });
    expect((sheet.A3 as XLSX.CellObject).v).toBe("'=cmd|calc");
  });

  it("shifts the header down when a subtitle is present", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test", subtitle: "ช่วง 1-7 ส.ค." });
    expect((sheet.A1 as XLSX.CellObject).v).toBe("ช่วง 1-7 ส.ค.");
    expect((sheet.A3 as XLSX.CellObject).v).toBe("Creator");
    expect(sheet["!panes"]).toEqual([
      { pane: "bottomLeft", ySplit: 3, state: "frozen", topLeftCell: "A4" },
    ]);
  });

  it("leaves a null metric as an empty cell rather than zero", () => {
    const sheet = buildSheet(rows, columns, { sheetName: "Test" });
    const cell = sheet.B3 as XLSX.CellObject | undefined;
    expect(cell?.v ?? null).toBeNull();
  });

  it("does not turn missing or invalid duration seconds into plausible times", () => {
    const invalid: (number | string | null)[] = [null, -1, NaN, Infinity, "502h 40m"];
    const sheet = buildSheet(invalid, [{ header: "Duration", format: "duration", value: (value) => value }], {
      sheetName: "Durations",
    });
    invalid.forEach((_, index) => expect(sheet[`A${index + 2}`]?.v ?? null).toBeNull());
  });
});

describe("pivotToSheet", () => {
  const pivot: PivotResult = {
    rowFields: [{ id: "r1", dimension: "ttAccountName" }],
    columnFields: [{ id: "c1", dimension: "campaignName" }],
    values: [{ id: "v1", metric: "grossRevenue", aggregation: "SUM" }],
    columnGroups: [
      { key: "2026-08-01", path: ["2026-08-01"] },
      { key: "2026-08-02", path: ["2026-08-02"] },
    ],
    rows: [
      {
        rowKey: ["creator.a"],
        cells: {
          [cellKey("2026-08-01", "v1")]: { value: 100, rowCount: 1 },
          [cellKey("2026-08-02", "v1")]: { value: 300, rowCount: 1 },
        },
      },
    ],
    columnTotals: {
      [cellKey("2026-08-01", "v1")]: { value: 100, rowCount: 1 },
      [cellKey("2026-08-02", "v1")]: { value: 300, rowCount: 1 },
    },
    grandTotals: { v1: { value: 400, rowCount: 2 } },
    matchedRows: 2,
  };

  it("emits one column per column group and value field", () => {
    const sheet = pivotToSheet(pivot, { sheetName: "Pivot" });
    expect(sheet.columns.map((c) => c.header)).toEqual([
      "TikTok display name",
      "2026-08-01 · Gross revenue",
      "2026-08-02 · Gross revenue",
    ]);
  });

  it("lays the cross-tab out with one row per row group plus a totals row", () => {
    const sheet = pivotToSheet(pivot, { sheetName: "Pivot" });
    expect(sheet.rows).toHaveLength(2);
    const worksheet = buildSheet(sheet.rows, sheet.columns, { sheetName: "Pivot" });
    expect((worksheet.B2 as XLSX.CellObject).v).toBe(100);
    expect((worksheet.C2 as XLSX.CellObject).v).toBe(300);
    expect((worksheet.A3 as XLSX.CellObject).v).toBe("รวมทั้งหมด");
  });

  it("drops the group prefix when there are no column fields", () => {
    const flat: PivotResult = {
      ...pivot,
      columnFields: [],
      columnGroups: [{ key: TOTAL_COLUMN_KEY, path: [] }],
      rows: [{ rowKey: ["creator.a"], cells: { [cellKey(TOTAL_COLUMN_KEY, "v1")]: { value: 400, rowCount: 2 } } }],
      columnTotals: { [cellKey(TOTAL_COLUMN_KEY, "v1")]: { value: 400, rowCount: 2 } },
    };
    const sheet = pivotToSheet(flat, { sheetName: "Pivot" });
    expect(sheet.columns.map((c) => c.header)).toEqual(["TikTok display name", "Gross revenue"]);
  });
});

describe("makeFileName", () => {
  it("appends an ISO date", () => {
    expect(makeFileName("gmv-max-report")).toMatch(/^gmv-max-report_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("keeps Thai characters in the suffix but drops separators", () => {
    expect(makeFileName("gmv", "สินค้า ยอดนิยม")).toMatch(/^gmv_สินค้า-ยอดนิยม_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
