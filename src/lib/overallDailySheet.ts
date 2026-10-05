import type { AllDayRow, RangeQuery, SummaryTotals } from "@/types/report";
import type { ExportColumn, WorkbookSheet } from "./exportExcel";

export interface OverallDailyRow extends AllDayRow {
  kind: "day" | "total";
  status: string;
}

const DAY_MS = 86_400_000;

/** Calendar dates, inclusive and timezone-independent. */
export function datesInRange(from: string, to: string): string[] {
  const parse = (value: string) => {
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
      throw new Error("ช่วงวันที่ไม่ถูกต้อง");
    }
    return ms;
  };
  const start = parse(from), end = parse(to);
  if (end < start) throw new Error("วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น");
  return Array.from({ length: (end - start) / DAY_MS + 1 }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
}

const missingDay = (statDate: string): AllDayRow => ({
  statDate, cost: null, orders: null, grossRevenue: null, roi: null,
  totalVideos: null, videosWithSales: null, creatorsWithSales: null,
});

function divide(numerator: number | null, denominator: number | null): number | null {
  return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
}

function sumKnown(rows: readonly AllDayRow[], key: "cost" | "orders" | "grossRevenue"): number | null {
  const values = rows.map((r) => r[key]).filter((v): v is number => v !== null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
}

export function overallDailyColumns(content: boolean): ExportColumn<OverallDailyRow>[] {
  const sumFormula = (letter: string): ExportColumn<OverallDailyRow>["formula"] => (row, ctx) => {
    if (row.kind !== "total") return null;
    const range = `${letter}${ctx.firstDataRow}:${letter}${ctx.rowNumber - 1}`;
    return `IF(COUNT(${range})=0,"",SUM(${range}))`;
  };
  const columns: ExportColumn<OverallDailyRow>[] = [
    { header: "Date", format: "date", width: 14, value: (r) => r.statDate },
    { header: "Cost", format: "currency", width: 19, value: (r) => r.cost, formula: sumFormula("B") },
    { header: "SKU orders", format: "integer", width: 15, value: (r) => r.orders, formula: sumFormula("C") },
    { header: "Gross revenue", format: "currency", width: 22, value: (r) => r.grossRevenue, formula: sumFormula("D") },
    {
      header: "ROI", format: "ratio", width: 13, value: (r) => divide(r.grossRevenue, r.cost),
      formula: (_r, { rowNumber: n }) => `IF(AND(ISNUMBER(D${n}),ISNUMBER(B${n}),B${n}>0),D${n}/B${n},"")`,
    },
    {
      header: "Cost per order", format: "currency", width: 22, value: (r) => divide(r.cost, r.orders),
      formula: (_r, { rowNumber: n }) => `IF(AND(ISNUMBER(B${n}),ISNUMBER(C${n}),C${n}>0),B${n}/C${n},"")`,
    },
  ];
  if (content) columns.push(
    // These total cells come from the period's distinct counts, never a SUM of daily counts.
    { header: "Videos advertised", format: "integer", width: 22, value: (r) => r.totalVideos },
    { header: "Videos with sales", format: "integer", width: 22, value: (r) => r.videosWithSales },
    { header: "Creators with sales", format: "integer", width: 24, value: (r) => r.creatorsWithSales },
  );
  columns.push({ header: "Data status", format: "text", width: 80, value: (r) => r.status });
  return columns;
}

/** Daily metrics already supported by /analytics/all, plus the distinct period counts. */
export function overallDailySheet(options: {
  days: readonly AllDayRow[];
  totals: SummaryTotals;
  range: RangeQuery;
  storeLabel: string;
  creatorLabel?: string;
  /** Reporting-local date, supplied by the UI for a partial-day label. */
  today: string;
}): WorkbookSheet<OverallDailyRow> {
  const { days, totals, range, today } = options;
  const content = range.promotionType !== "LIVE";
  const byDate = new Map<string, AllDayRow>();
  for (const day of days) {
    if (day.statDate < range.from || day.statDate > range.to) continue;
    if (byDate.has(day.statDate)) throw new Error(`พบข้อมูลรายวันซ้ำ: ${day.statDate}`);
    byDate.set(day.statDate, day);
  }
  const rows: OverallDailyRow[] = datesInRange(range.from, range.to).map((statDate) => {
    const day = byDate.get(statDate);
    const incomplete = day && [day.cost, day.orders, day.grossRevenue,
      ...(content ? [day.totalVideos, day.videosWithSales, day.creatorsWithSales] : []),
    ].some((value) => value === null);
    return {
      ...(day ?? missingDay(statDate)), kind: "day",
      status: statDate > today ? "ยังไม่ถึงวันที่รายงาน"
        : !day ? "ไม่มีข้อมูลในระบบ"
        : statDate === today ? "ข้อมูลระหว่างวัน (ยังไม่จบวัน)"
        : incomplete ? "ข้อมูลบางตัวชี้วัดไม่ครบ"
        : "มีข้อมูลในระบบ",
    };
  });
  const cost = sumKnown(rows, "cost"), orders = sumKnown(rows, "orders"), grossRevenue = sumKnown(rows, "grossRevenue");
  const available = byDate.size;
  rows.push({
    kind: "total", statDate: "Total", cost, orders, grossRevenue, roi: divide(grossRevenue, cost),
    totalVideos: available ? totals.totalVideos : null,
    videosWithSales: available ? totals.videosWithSales : null,
    creatorsWithSales: available ? totals.creatorsWithSales : null,
    status: [
      `รวมข้อมูลที่มี ${available}/${rows.length} วัน`,
      content ? "วิดีโอ/ครีเอเตอร์นับไม่ซ้ำทั้งช่วง" : null,
      range.from <= today && range.to >= today ? "วันนี้ยังไม่จบวัน" : null,
    ].filter(Boolean).join(" · "),
  });
  return {
    name: "Overall daily", rows, columns: overallDailyColumns(content),
    subtitle: [
      `GMV Max ${content ? "Product" : "LIVE"}`, options.storeLabel,
      `${range.from} ถึง ${range.to}`, options.creatorLabel,
    ].filter(Boolean).join(" · "),
  };
}
