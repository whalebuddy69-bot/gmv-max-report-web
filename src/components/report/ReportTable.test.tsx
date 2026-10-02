import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportTable, reportExportColumns } from "./ReportTable";
import type { ReportRow } from "@/types/report";

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
