import type { LiveRoomRow } from "@/types/report";
import type { ExportColumn, ExportFormat } from "@/lib/exportExcel";
import { parseDurationLabel } from "./format";

export interface LiveRoomColumn extends ExportColumn<LiveRoomRow> {
  /** Stable id, so the table can special-case a cell without matching on its header. */
  key: string;
  align: "left" | "right";
  /** The field the table sorts this column on */
  sortKey?: keyof LiveRoomRow;
}

/** "2026-09-01 19:00:00" -> "2026-09-01". Null when there is nothing to split. */
function datePart(raw: string | null): string | null {
  return raw?.trim().split(/[T ]/)[0] ?? null;
}

/** The other half of the same split. */
function timePart(raw: string | null): string | null {
  return raw?.trim().split(/[T ]/)[1] ?? null;
}

/** Formats whose value is a string the sheet turns into a date cell, not a number. */
const DATE_FORMATS = new Set<ExportFormat>(["date", "datetime", "time"]);

/** True when this column's non-null values are numbers, so a table can format them. */
export function isNumericColumn(column: LiveRoomColumn): boolean {
  return column.format !== "text" && !DATE_FORMATS.has(column.format);
}

export function liveRoomColumns(options: {
  /** Included only when the data spans more than one shop, matching the other tables. */
  showStore: boolean;
  storeNames: Map<string, string>;
  /** `/analytics/live-rooms` returns only campaign_id; the name is joined in. */
  campaignNames: Map<string, string>;
  /** Creator per campaign_id, joined in for the same reason */
  creatorNames: Map<string, string>;
}): LiveRoomColumn[] {
  const { showStore, storeNames, campaignNames, creatorNames } = options;

  const columns: LiveRoomColumn[] = [
    { key: "liveName", header: "live_name", format: "text", align: "left", sortKey: "liveName", value: (row) => row.liveName, width: 34 },
    { key: "roomId", header: "room_id", format: "text", align: "left", value: (row) => row.roomId, width: 22 },
  ];

  if (showStore) {
    columns.push({
      key: "storeName",
      header: "store_name",
      format: "text",
      align: "left",
      value: (row) => storeNames.get(row.storeId) ?? row.storeId,
      width: 22,
    });
  }

  columns.push(
    { key: "campaignId", header: "campaign_id", format: "text", align: "left", value: (row) => row.campaignId, width: 22 },
    { key: "campaignName", header: "campaign_name", format: "text", align: "left", sortKey: "campaignId", value: (row) => campaignNames.get(row.campaignId) ?? null, width: 30 },
    { key: "ttAccountName", header: "tt_account_name", format: "text", align: "left", sortKey: "campaignId", value: (row) => creatorNames.get(row.campaignId) ?? null, width: 24 },
    { key: "liveStatus", header: "live_status", format: "text", align: "left", value: (row) => row.liveStatus, width: 12 },

    /*
     * Written as Excel serials by the sheet, so it can filter by month and subtract one stream
     * from another
     */
    { key: "startDate", header: "start_date", format: "date", align: "left", sortKey: "startDate", value: (row) => row.startDate ?? datePart(row.liveLaunchedTime), width: 13 },
    { key: "startTime", header: "start_time", format: "time", align: "left", value: (row) => row.startTime ?? timePart(row.liveLaunchedTime), width: 12 },
    { key: "endDate", header: "end_date", format: "date", align: "left", value: (row) => datePart(row.endTime), width: 13 },
    { key: "endTime", header: "end_time", format: "time", align: "left", value: (row) => timePart(row.endTime), width: 12 },
    { key: "liveDuration", header: "live_duration", format: "text", align: "right", sortKey: "durationSeconds", value: (row) => row.liveDuration, width: 14 },

    { key: "cost", header: "cost", format: "currency", align: "right", sortKey: "cost", value: (row) => row.cost },
    { key: "orders", header: "orders (Current shop)", format: "integer", align: "right", sortKey: "orders", value: (row) => row.orders, width: 20 },
    { key: "grossRevenue", header: "gross_revenue (Current shop)", format: "currency", align: "right", sortKey: "grossRevenue", value: (row) => row.grossRevenue, width: 26 },
    { key: "roi", header: "roi (Current shop)", format: "ratio", align: "right", sortKey: "roi", value: (row) => row.roi, width: 18 },
    { key: "costPerOrder", header: "cost_per_order (Current shop)", format: "currency", align: "right", sortKey: "costPerOrder", value: (row) => row.costPerOrder, width: 26 },

    { key: "liveViews", header: "live_views", format: "integer", align: "right", sortKey: "liveViews", value: (row) => row.liveViews },
    { key: "costPerLiveView", header: "cost_per_live_view", format: "currency", align: "right", sortKey: "costPerLiveView", value: (row) => row.costPerLiveView },
    // TikTok's names for these two start with a digit and are long
    { key: "liveViews10s", header: "10_second_live_views", format: "integer", align: "right", sortKey: "liveViews10s", value: (row) => row.liveViews10s, width: 20 },
    { key: "costPerLiveView10s", header: "cost_per_10_second_live_view", format: "currency", align: "right", sortKey: "costPerLiveView10s", value: (row) => row.costPerLiveView10s, width: 26 },
    { key: "liveFollows", header: "live_follows", format: "integer", align: "right", sortKey: "liveFollows", value: (row) => row.liveFollows },
  );

  return columns;
}

/** Keep the dashboard label, but export an additive Excel duration in the same column. */
export function liveRoomExportColumns(
  options: Parameters<typeof liveRoomColumns>[0],
): ExportColumn<LiveRoomRow>[] {
  return liveRoomColumns(options).map((column) => column.key === "liveDuration"
    ? {
        ...column,
        format: "duration",
        value: (row: LiveRoomRow) => row.durationSeconds ?? parseDurationLabel(row.liveDuration),
      }
    : column);
}
