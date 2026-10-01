import type { AllDayRow } from "@/types/report";
import type { ExportColumn } from "@/lib/exportExcel";

/** Recomputed per row, never summed: a ratio of sums is not the sum of ratios. */
function costPerOrder(row: AllDayRow): number | null {
  if (!row.cost || !row.orders) return null;
  return row.cost / row.orders;
}

export function dailyTotalsColumns(options: {
  /** The three video/creator counts */
  content: boolean;
}): ExportColumn<AllDayRow>[] {
  const columns: ExportColumn<AllDayRow>[] = [
    // A real date cell, so the sheet can filter by month and sort chronologically.
    { header: "stat_date", format: "date", value: (row) => row.statDate, width: 13 },
    { header: "cost", format: "currency", value: (row) => row.cost },
    { header: "orders", format: "integer", value: (row) => row.orders },
    { header: "gross_revenue", format: "currency", value: (row) => row.grossRevenue },
    { header: "roi", format: "ratio", value: (row) => row.roi },
    { header: "cost_per_order", format: "currency", value: costPerOrder },
  ];

  if (options.content) {
    columns.push(
      // Named for what they count rather than after the cards: "Videos advertised" is a label
      // with a tooltip behind it, and these headers have to stand alone
      { header: "videos_advertised", format: "integer", value: (row) => row.totalVideos, width: 18 },
      { header: "videos_with_sales", format: "integer", value: (row) => row.videosWithSales, width: 18 },
      { header: "creators_with_sales", format: "integer", value: (row) => row.creatorsWithSales, width: 20 },
    );
  }

  return columns;
}
