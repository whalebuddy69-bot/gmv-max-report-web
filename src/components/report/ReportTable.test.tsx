import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreativeStatusCell, ReportTable, reportExportColumns } from "./ReportTable";
import type { ReportRow } from "@/types/report";
import { buildSheet } from "@/lib/exportExcel";
import { utils } from "xlsx";

describe("creator columns", () => {
  it("puts username immediately after display name in the table and export", () => {
    const columns = reportExportColumns().filter((c) => c.kind === "dimension");
    const i = columns.findIndex((c) => c.key === "ttAccountName");
    expect(columns[i + 1]?.key).toBe("ttAccountUsername");
    const row = { itemId: "7683142323382832402", ttAccountName: "Su Pyae", ttAccountUsername: "khaingsupyae999", shopContentType: "VIDEO" } as ReportRow;
    const html = renderToStaticMarkup(<ReportTable rows={[row]} isLoading={false} isFetching={false} error={null} onRetry={() => {}} sortBy="cost" sortDir="desc" onSortChange={() => {}} />);
    expect(html).toContain("TikTok display name");
    expect(html).toContain("TikTok username");
    expect(html).toContain("Su Pyae");
    expect(html).toContain("khaingsupyae999");
    expect(html.indexOf("Su Pyae")).toBeLessThan(html.indexOf("khaingsupyae999"));
  });
});

describe("delivery status columns", () => {
  const row = {
    itemId: "video-1", shopContentType: "VIDEO", creativeDeliveryStatus: "LEARNING",
    creativeDeliveryStatusCheckedAt: "2026-10-06T19:20:30Z", creativeDeliveryStatusStatDate: "2026-10-05",
  } as ReportRow;

  it("exposes opt-in columns without changing the default table layout", () => {
    const columns = reportExportColumns([row]).filter((column) => column.kind === "dimension");
    expect(columns.filter((column) => column.key.startsWith("creativeDeliveryStatus")).map((column) => column.header))
      .toEqual(["Latest known delivery status", "Status checked at (Asia/Bangkok)", "Status source report date"]);
    const html = renderToStaticMarkup(<ReportTable rows={[row]} isLoading={false} isFetching={false} error={null} onRetry={() => {}} sortBy="cost" sortDir="desc" onSortChange={() => {}} />);
    expect(html).not.toContain("LEARNING");
    expect(html).not.toContain("2026-10-07 02:20:30");
  });

  it("renders status with a source date/sync-time explanation and legacy fallback", () => {
    const verified = renderToStaticMarkup(<CreativeStatusCell row={row} field="creativeDeliveryStatus" />);
    expect(verified).toContain(">LEARNING</span>");
    expect(verified).toContain("Latest known delivery status");
    expect(verified).toContain("2026-10-05");
    expect(verified).toContain("ไม่ใช่ Exploration status");
    const timestamp = renderToStaticMarkup(<CreativeStatusCell row={row} field="creativeDeliveryStatusCheckedAt" />);
    expect(timestamp).toContain("2026-10-07 02:20:30 +07:00");
    const old = { ...row, creativeDeliveryStatusCheckedAt: undefined, creativeDeliveryStatusStatDate: undefined };
    expect(renderToStaticMarkup(<CreativeStatusCell row={old} field="creativeDeliveryStatus" />)).toContain("latest status not verified");
    expect(renderToStaticMarkup(<CreativeStatusCell row={old} field="creativeDeliveryStatusCheckedAt" />)).toContain("(ยังไม่ทราบเวลาตรวจสอบ)");
  });

  it("exports timezone-explicit freshness and labels legacy rows unverified", () => {
    const old = { ...row, creativeDeliveryStatusCheckedAt: undefined, creativeDeliveryStatusStatDate: undefined };
    const rows = [row, old];
    const columns = reportExportColumns(rows).flatMap((column) => column.kind === "dimension" && column.value
      ? [{ header: column.header, value: column.value, format: "text" as const }] : []);
    const sheet = buildSheet(rows, columns, { sheetName: "Status" });
    const data = utils.sheet_to_json<string[]>(sheet, { header: 1, defval: null });
    expect(data[0]).toEqual(["Delivery status", "Status checked at (Asia/Bangkok)", "Status source report date"]);
    expect(data[1]).toEqual(["LEARNING", "2026-10-07 02:20:30 +07:00", "2026-10-05"]);
    expect(data[2]).toEqual(["LEARNING (latest status not verified)", null, null]);
  });
});
