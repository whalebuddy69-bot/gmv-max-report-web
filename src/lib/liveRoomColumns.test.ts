import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { LiveRoomRow } from "@/types/report";
import { isNumericColumn, liveRoomColumns, liveRoomExportColumns } from "./liveRoomColumns";
import { buildSheet } from "./exportExcel";

function room(over: Partial<LiveRoomRow> = {}): LiveRoomRow {
  return {
    storeId: "store-1",
    campaignId: "camp-1",
    roomId: "room-1",
    liveName: "ไลฟ์เย็นวันศุกร์",
    liveStatus: "END",
    liveLaunchedTime: "2026-09-01 19:00",
    liveDuration: "14h 1m",
    startDate: "2026-09-01",
    startTime: "19:00:00",
    endTime: "2026-09-02 09:01:00",
    durationSeconds: 50_460,
    cost: 1000,
    netCost: 980,
    orders: 40,
    grossRevenue: 5000,
    roi: 5,
    costPerOrder: 25,
    liveViews: 12_000,
    liveViews10s: 4_000,
    costPerLiveView: 0.083,
    costPerLiveView10s: 0.25,
    liveFollows: 130,
    ...over,
  };
}

const CAMPAIGN_NAMES = new Map([["camp-1", "Cozyhouse LIVE · เย็นวันศุกร์"]]);
const CREATOR_NAMES = new Map([["camp-1", "@cozyhouse.live"]]);
const noStores = {
  showStore: false,
  storeNames: new Map<string, string>(),
  campaignNames: CAMPAIGN_NAMES,
  creatorNames: CREATOR_NAMES,
};

describe("liveRoomColumns", () => {
  it("marks the shop-scoped metrics the way TikTok labels them", () => {
    const headers = liveRoomColumns(noStores).map((column) => column.header);

    // A stream can promote several shops' products while these count only this one
    expect(headers).toContain("orders (Current shop)");
    expect(headers).toContain("gross_revenue (Current shop)");
    expect(headers).toContain("roi (Current shop)");
    expect(headers).toContain("cost_per_order (Current shop)");

    // The service stopped returning the all-shops counterparts
    expect(headers.some((header) => header.startsWith("all_shops"))).toBe(false);
  });

  it("reads each metric off its own field", () => {
    const columns = liveRoomColumns(noStores);
    const row = room();
    const byHeader = new Map(columns.map((column) => [column.header, column.value(row)]));

    expect(byHeader.get("orders (Current shop)")).toBe(40);
    expect(byHeader.get("gross_revenue (Current shop)")).toBe(5000);
    expect(byHeader.get("live_views")).toBe(12_000);
    expect(byHeader.get("10_second_live_views")).toBe(4_000);
    expect(byHeader.get("live_follows")).toBe(130);
  });

  it("shows TikTok's duration label and ranks it on the seconds behind it", () => {
    const columns = liveRoomColumns(noStores);
    const label = columns.find((column) => column.header === "live_duration");

    expect(label?.format).toBe("text");
    expect(label?.value(room())).toBe("14h 1m");
    // There is no seconds column of its own any more, which makes this the only path by which a
    // reader can rank duration at all
    expect(columns.some((column) => column.key === "durationSeconds")).toBe(false);
    expect(label?.sortKey).toBe("durationSeconds");
  });

  it("writes the start and end as real date cells, not text", () => {
    const columns = liveRoomColumns(noStores);
    const byHeader = new Map(columns.map((column) => [column.header, column]));

    expect(byHeader.get("start_date")?.format).toBe("date");
    expect(byHeader.get("start_time")?.format).toBe("time");
    expect(byHeader.get("end_date")?.format).toBe("date");
    expect(byHeader.get("end_time")?.format).toBe("time");

    // The end is one timestamp from TikTok, split the way the start already is.
    expect(byHeader.get("end_date")?.value(room())).toBe("2026-09-02");
    expect(byHeader.get("end_time")?.value(room())).toBe("09:01:00");

    const sheet = buildSheet([room()], columns, { sheetName: "Live rooms" });
    const header = columns.map((column) => column.header);
    const cellAt = (label: string) =>
      sheet[XLSX.utils.encode_cell({ r: 1, c: header.indexOf(label) })] as XLSX.CellObject;

    /* 2026-09-01 is serial 46266 */
    const start = cellAt("start_date");
    expect(start.t).toBe("n");
    expect(start.v).toBe(46_266);
    expect(start.z).toBe("yyyy-mm-dd");

    // 19:00:00 is 19/24 of a day.
    const startTime = cellAt("start_time");
    expect(startTime.t).toBe("n");
    expect(startTime.v).toBeCloseTo(19 / 24, 10);

    // The next day, the date part must roll over, not stay on the 1st.
    const endDate = cellAt("end_date");
    expect(endDate.t).toBe("n");
    expect(endDate.v).toBe(46_267);
  });

  it("falls back to the raw launch timestamp when the service has not split it", () => {
    const columns = liveRoomColumns(noStores);
    const unsplit = room({ startDate: null, startTime: null });

    expect(columns.find((c) => c.header === "start_date")?.value(unsplit)).toBe("2026-09-01");
    expect(columns.find((c) => c.header === "start_time")?.value(unsplit)).toBe("19:00");
  });

  it("writes an unparseable timestamp through as text rather than losing it", () => {
    const columns = liveRoomColumns(noStores);
    const odd = room({ startDate: "เมื่อวานนี้", startTime: null, liveLaunchedTime: null });

    const sheet = buildSheet([odd], columns, { sheetName: "Live rooms" });
    const index = columns.findIndex((column) => column.header === "start_date");
    const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: index })] as XLSX.CellObject;

    // A shape TikTok has not documented should still show what it said.
    expect(cell.t).toBe("s");
    expect(cell.v).toBe("เมื่อวานนี้");
  });

  it("adds the store column only when asked, resolving the id to a name", () => {
    expect(liveRoomColumns(noStores).some((c) => c.header === "store_name")).toBe(false);

    const columns = liveRoomColumns({
      showStore: true,
      storeNames: new Map([["store-1", "CozyhouseOfficial"]]),
      campaignNames: CAMPAIGN_NAMES,
      creatorNames: CREATOR_NAMES,
    });
    const store = columns.find((column) => column.header === "store_name");
    expect(store?.value(room())).toBe("CozyhouseOfficial");
    // An id with no name still has to export as something.
    expect(store?.value(room({ storeId: "store-unknown" }))).toBe("store-unknown");
  });

  it("puts campaign_name straight after campaign_id, resolved from the id", () => {
    const columns = liveRoomColumns(noStores);
    const keys = columns.map((column) => column.key);

    // /analytics/live-rooms returns only the id
    expect(keys.indexOf("campaignName")).toBe(keys.indexOf("campaignId") + 1);

    const name = columns.find((column) => column.key === "campaignName");
    expect(name?.value(room())).toBe("Cozyhouse LIVE · เย็นวันศุกร์");
    expect(name?.value(room({ campaignId: "camp-unknown" }))).toBeNull();
  });

  it("gives every column an id, and every figure something to sort on", () => {
    const columns = liveRoomColumns({ showStore: true, storeNames: new Map(), campaignNames: new Map(), creatorNames: new Map() });

    // Ids are what the table special-cases on instead of matching Thai header text.
    expect(new Set(columns.map((c) => c.key)).size).toBe(columns.length);

    // A number a reader cannot rank is a number they have to export to use.
    for (const column of columns.filter(isNumericColumn)) {
      expect(column.sortKey, `${column.key} has no sortKey`).toBeDefined();
    }
  });

  it("sorts the duration label on the seconds, never on the text", () => {
    const columns = liveRoomColumns(noStores);
    const label = columns.find((column) => column.key === "liveDuration");

    // "15h 59m 32s" sorts below "3h 12m" as text
    expect(label?.sortKey).toBe("durationSeconds");
  });

  it("survives a room where every metric is null", () => {
    const empty = room({
      cost: null, netCost: null, orders: null, grossRevenue: null, roi: null,
      costPerOrder: null, liveViews: null,
      liveViews10s: null, costPerLiveView: null, costPerLiveView10s: null,
      liveFollows: null, liveName: null, liveStatus: null, liveDuration: null,
      liveLaunchedTime: null, startDate: null, startTime: null, endTime: null,
      durationSeconds: null,
    });

    const sheet = buildSheet([empty], liveRoomColumns(noStores), { sheetName: "Live rooms" });
    expect(sheet).toBeDefined();
  });
});

describe("liveRoomExportColumns", () => {
  it("preserves column order and all non-duration values", () => {
    const display = liveRoomColumns(noStores);
    const exported = liveRoomExportColumns(noStores);
    expect(exported.map((column) => column.header)).toEqual(display.map((column) => column.header));
    exported.forEach((column, index) => {
      if (column.header === "live_duration") return;
      expect(column.format).toBe(display[index]?.format);
      expect(column.value(room())).toBe(display[index]?.value(room()));
    });
  });

  it.each([false, true])("round-trips numeric elapsed durations (showStore=%s)", (showStore) => {
    const columns = liveRoomExportColumns({ ...noStores, showStore });
    const seconds = [502 * 3600 + 40 * 60, 25 * 3600 + 20 * 60 + 32, 32, 0];
    const rows = seconds.map((durationSeconds) => room({ durationSeconds }));
    rows.push(room({ liveDuration: null, durationSeconds: null }));
    const sheet = buildSheet(rows, columns, { sheetName: "Live rooms", subtitle: "LIVE GMV Max" });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Live rooms");
    const reopened = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), {
      type: "buffer", cellNF: true, cellDates: false,
    }).Sheets["Live rooms"]!;
    const durationIndex = columns.findIndex((column) => column.header === "live_duration");
    const cells = seconds.map((_, index) => reopened[XLSX.utils.encode_cell({ r: index + 3, c: durationIndex })] as XLSX.CellObject);

    cells.forEach((cell, index) => {
      expect(cell.t).toBe("n");
      expect(cell.v).toBeCloseTo(seconds[index]! / 86_400, 12);
      expect(cell.z).toBe("[h]:mm:ss");
    });
    expect(cells.map((cell) => XLSX.utils.format_cell(cell))).toEqual(["502:40:00", "25:20:32", "0:00:32", "0:00:00"]);
    // Numeric SUM keeps all seconds and does not wrap the combined hours at 24.
    const sum = cells.reduce((total, cell) => total + Number(cell.v), 0);
    expect(sum * 86_400).toBeCloseTo(seconds.reduce((a, b) => a + b, 0), 6);
    expect(XLSX.SSF.format("[h]:mm:ss", sum)).toBe("528:01:04");
    expect(reopened[XLSX.utils.encode_cell({ r: 7, c: durationIndex })]?.v ?? null).toBeNull();
  });

  it("falls back to the duration label only when seconds are missing", () => {
    const column = liveRoomExportColumns(noStores).find((c) => c.header === "live_duration")!;
    expect(column.value(room({ durationSeconds: null, liveDuration: "502h 40m" }))).toBe(1_809_600);
    expect(column.value(room({ durationSeconds: 0, liveDuration: "1h" }))).toBe(0);
    expect(column.value(room({ durationSeconds: null, liveDuration: "unknown" }))).toBeNull();
  });
});
