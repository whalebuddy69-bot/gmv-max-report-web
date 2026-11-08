import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationCampaignToday } from "@/api/automationCampaignsToday";
import type { CreatorOverviewRow } from "@/lib/creatorOverview";
import { CreatorCampaignAlignedRows, CreatorOverviewExpansionRow, CreatorOverviewTable, CreatorOverviewTableView, sortCreatorOverviewRows } from "./CreatorOverviewTable";

const base = {
  clientId: "creator-1",
  displayName: "Creator 1",
  tiktokAccountId: "1234567890123456789",
  access: "verified",
  active: null,
  campaignName: null,
  scheduleTime: null,
  autoBudget: null,
  totalBudgetMinor: null,
  maxBudgetMinor: null,
  viewerBoostBudgetMinor: null,
  roiTarget: null,
  costMinor: null,
  gmvMinor: null,
  skuOrders: null,
  costPerOrderMinor: null,
  liveViews: null,
  costPerLiveViewMinor: null,
} satisfies CreatorOverviewRow;
const collapsed = { expanded: new Set<string>(), onToggleExpand: () => {}, renderExpanded: () => null };
const campaign = {
  campaignId: "9876543210123456789", campaignName: "Live campaign", operationStatus: "ENABLE", dailyBudgetMinor: 15_000,
  targetRoi: 4, spendMinor: 2_000, gmvMinor: 5_000, skuOrders: 2, liveViews: 0, viewerBoostBudgetMinor: null,
  roi: 2.5, activityToday: true, scheduleStartAt: "2026-11-08T00:00:00Z", scheduleEndAt: null,
} satisfies AutomationCampaignToday;
const today = Date.parse("2026-11-08T01:00:00Z");

describe("Creator overview sorting", () => {
  it("sorts numerically without mutating input; missing values remain last in either direction", () => {
    const rows = [
      { ...base, displayName: "unknown", costMinor: null },
      { ...base, displayName: "larger", costMinor: 1240 },
      { ...base, displayName: "zero", costMinor: 0 },
      { ...base, displayName: "smaller", costMinor: 925 },
      { ...base, displayName: "broken", costMinor: Infinity },
    ];
    const names = (direction: "ascending" | "descending") => sortCreatorOverviewRows(rows, { key: "costMinor", direction }).map(({ displayName }) => displayName);
    expect(names("ascending")).toEqual(["zero", "smaller", "larger", "broken", "unknown"]);
    expect(names("descending")).toEqual(["larger", "smaller", "zero", "broken", "unknown"]);
    expect(rows[0]?.displayName).toBe("unknown");
  });

  it("keeps tied figures in natural Creator order and uses the actual schedule instant", () => {
    const rows = [
      { ...base, clientId: "10", displayName: "Creator 10", liveViews: 5, scheduleTime: { startAt: "2026-11-08T05:00:00+07:00", endAt: null } },
      { ...base, clientId: "2", displayName: "Creator 2", liveViews: 5, scheduleTime: { startAt: "2026-11-07T21:00:00Z", endAt: null } },
      { ...base, clientId: "5", displayName: "Creator 5", liveViews: 5, scheduleTime: { startAt: "invalid", endAt: null } },
    ];
    expect(sortCreatorOverviewRows(rows, { key: "liveViews", direction: "descending" }).map(({ clientId }) => clientId)).toEqual(["2", "5", "10"]);
    expect(sortCreatorOverviewRows(rows, { key: "scheduleTime", direction: "ascending" }).map(({ clientId }) => clientId)).toEqual(["2", "10", "5"]);
  });

  it("sorts status by known enabled/disabled first and name by the visible username", () => {
    const rows: CreatorOverviewRow[] = [
      { ...base, clientId: "x", displayName: "Alpha", tiktokUsername: "zebra", active: false },
      { ...base, clientId: "y", displayName: "Zulu", tiktokUsername: "alpha", active: true },
      { ...base, clientId: "z", displayName: "Zulu 2", active: null },
    ];
    expect(sortCreatorOverviewRows(rows, { key: "status", direction: "ascending" }).map(({ clientId }) => clientId)).toEqual(["x", "y", "z"]);
    expect(sortCreatorOverviewRows(rows, { key: "status", direction: "descending" }).map(({ clientId }) => clientId)).toEqual(["y", "x", "z"]);
    expect(sortCreatorOverviewRows(rows.slice(0, 2), { key: "displayName", direction: "ascending" }).map(({ clientId }) => clientId)).toEqual(["y", "x"]);
  });
});

describe("Creator overview table", () => {
  it("offers two column groups, scoped row controls, and distinct real zero / missing values", () => {
    const row = { ...base, active: true, tiktokUsername: "creator_verified", costMinor: 12_345, gmvMinor: 0, skuOrders: 0,
      scheduleTime: { startAt: "2026-11-07T22:00:00Z", endAt: "2026-11-08T01:00:00Z" }, autoBudget: "blocked" as const };
    const html = renderToStaticMarkup(<CreatorOverviewTable rows={[row]} {...collapsed} />);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('scope="row"');
    expect(html.match(/scope="colgroup"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="ซ่อนคอลัมน์ทั้งหมดใน Setup"');
    expect(html).toContain('aria-label="ซ่อนคอลัมน์ทั้งหมดใน Performance"');
    expect(html).toContain('aria-label="ขยายแคมเปญของ @creator_verified"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Edit");
    expect(html).toContain("Live หมายถึงแคมเปญเปิดอยู่ ไม่ได้ยืนยันว่าห้องกำลัง LIVE");
    const topHeader = html.split("<thead>")[1]?.split("</tr>")[0] ?? "";
    expect(topHeader.indexOf('aria-label="TikTok account:')).toBeLessThan(topHeader.indexOf('aria-label="Status:'));
    expect(topHeader.indexOf('aria-label="Status:')).toBeLessThan(topHeader.indexOf('scope="colgroup"'));
    expect(topHeader.match(/rowspan="2"/g)).toHaveLength(2);
    expect(topHeader).toMatch(/scope="colgroup" colSpan="6"[^>]*>Setup</);
    expect(html.match(/sticky left-\[var\(--overview-account-width\)\]/g)).toHaveLength(2);
    expect(html.indexOf('aria-label="Status:')).toBeLessThan(html.indexOf('aria-label="Schedule time:'));
    expect(html).toContain("TikTok account และ Status แสดงเสมอ");
    expect(html.match(/type="checkbox"/g)).toHaveLength(13);
    expect(html).toContain("1234567890123456789");
    expect(html).toContain("05:00–08:00");
    expect(html).toContain("พัก · ต้องตรวจสอบ");
    expect(html).toContain("฿123.45");
    expect(html).toContain("฿0.00");
    expect(html).toContain("ไม่มีข้อมูล");
  });

  it("adjusts group spans and keeps TikTok account and Status when other columns are hidden", () => {
    const onlyCost = renderToStaticMarkup(<CreatorOverviewTableView rows={[base]} hidden={new Set([
      "scheduleTime", "autoBudget", "totalBudgetMinor", "maxBudgetMinor", "viewerBoostBudgetMinor", "roiTarget", "gmvMinor", "roiActual",
      "skuOrders", "costPerOrderMinor", "liveViews", "costPerLiveViewMinor",
    ])} sort={{ key: "costMinor", direction: "descending" }} {...collapsed} onSort={() => {}} />);
    expect(onlyCost.match(/scope="colgroup"/g)).toHaveLength(1);
    expect(onlyCost).toContain('colSpan="1"');
    expect(onlyCost).toContain('aria-sort="descending"');
    expect(onlyCost).toContain('aria-label="Cost: เรียงน้อยไปมาก (ASC)"');
    expect(onlyCost).toContain('aria-label="ขยายแคมเปญของ Creator 1"');
    expect(onlyCost).toContain('aria-label="Status:');
    expect(onlyCost).not.toContain("Schedule time");

    const onlyAccount = renderToStaticMarkup(<CreatorOverviewTableView rows={[base]} hidden={new Set([
      "scheduleTime", "autoBudget", "totalBudgetMinor", "maxBudgetMinor", "viewerBoostBudgetMinor", "roiTarget", "costMinor", "gmvMinor", "roiActual",
      "skuOrders", "costPerOrderMinor", "liveViews", "costPerLiveViewMinor",
    ])} sort={{ key: "displayName", direction: "ascending" }} {...collapsed} onSort={() => {}} />);
    expect(onlyAccount).not.toContain('scope="colgroup"');
    expect(onlyAccount).not.toContain('rowspan="2"');
    expect(onlyAccount).toContain('aria-label="ขยายแคมเปญของ Creator 1"');
    expect(onlyAccount).toContain('aria-label="Status:');
  });

  it("renders the selected account toolbar only, in one full-width row bound to the disclosure", () => {
    const another = { ...base, clientId: "another", displayName: "Another Creator" };
    const renderExpanded = vi.fn<React.ComponentProps<typeof CreatorOverviewTable>["renderExpanded"]>((row, layout) =>
      <CreatorOverviewExpansionRow layout={layout} anchor><p>{`Campaign table for ${row.clientId}`}</p></CreatorOverviewExpansionRow>);
    const html = renderToStaticMarkup(<CreatorOverviewTable rows={[base, another]} {...collapsed}
      expanded={new Set([another.clientId])} renderExpanded={renderExpanded} />);
    expect(renderExpanded).toHaveBeenCalledTimes(1);
    expect(renderExpanded).toHaveBeenCalledWith(another, expect.objectContaining({ totalColumns: 15 }));
    expect(html).toMatch(/aria-expanded="true" aria-controls="([^"]+-campaigns-another)"/);
    const id = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('colSpan="15"');
    expect(html).toContain("Campaign table for another");
    expect(html).not.toContain("Campaign table for creator-1");
    expect(html).toContain("[width:100cqi]");
  });

  it("uses one physical table and the same visible column order for account and campaign", () => {
    const html = renderToStaticMarkup(<CreatorOverviewTableView rows={[{ ...base, maxBudgetMinor: 55_500, autoBudget: "on", roiActual: 4.2 }]}
      hidden={new Set(["gmvMinor", "totalBudgetMinor"])} sort={{ key: "displayName", direction: "ascending" }}
      expanded={new Set([base.clientId])} onToggleExpand={() => {}} onSort={() => {}} renderExpanded={(_row, layout) =>
        <CreatorCampaignAlignedRows layout={layout} rows={[campaign]} now={today} renderIdentity={(item) => <span>{item.campaignName}</span>} />} />);
    const main = html.split('data-overview-row="account">')[1]?.split("</tr>")[0] ?? "";
    const sub = html.split('data-overview-row="campaign">')[1]?.split("</tr>")[0] ?? "";
    const keys = (row: string) => [...row.matchAll(/data-column="([^"]+)"/g)].map((match) => match[1]);
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(html.match(/<thead\b/g)).toHaveLength(1);
    expect(keys(sub)).toEqual(keys(main));
    expect(keys(sub).slice(0, 3)).toEqual(["status", "viewerBoostBudgetMinor", "scheduleTime"]);
    expect(keys(sub)).not.toContain("gmvMinor");
    expect(keys(sub)).not.toContain("totalBudgetMinor");
    expect(main).toContain("฿555.00");
    expect(main).toContain("4.20×");
    expect(sub).not.toContain("฿555.00");
    expect(sub).toContain("฿20.00");
    expect(sub).toContain("2.50×");
    expect(sub).toContain("฿10.00");
    expect(sub).toMatch(/data-column="liveViews">0</);
    expect(sub).toMatch(/data-column="costPerLiveViewMinor">.*ไม่มีข้อมูล/);
  });
});
