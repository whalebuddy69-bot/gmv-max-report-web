import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CreatorOverviewRow } from "@/lib/creatorOverview";
import { CreatorOverviewTable, CreatorOverviewTableView, sortCreatorOverviewRows } from "./CreatorOverviewTable";

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
});

describe("Creator overview table", () => {
  it("offers two column groups, scoped row controls, and distinct real zero / missing values", () => {
    const row = { ...base, active: true, costMinor: 12_345, gmvMinor: 0, skuOrders: 0,
      scheduleTime: { startAt: "2026-11-07T22:00:00Z", endAt: "2026-11-08T01:00:00Z" }, autoBudget: "blocked" as const };
    const html = renderToStaticMarkup(<CreatorOverviewTable rows={[row]} onEdit={() => {}} />);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('scope="row"');
    expect(html.match(/scope="colgroup"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="ซ่อนคอลัมน์ทั้งหมดใน Setup"');
    expect(html).toContain('aria-label="ซ่อนคอลัมน์ทั้งหมดใน Performance"');
    expect(html).toContain('aria-label="Edit Creator 1"');
    expect(html).toContain("1234567890123456789");
    expect(html).toContain("05:00–08:00");
    expect(html).toContain("พัก · ต้องตรวจสอบ");
    expect(html).toContain("฿123.45");
    expect(html).toContain("฿0.00");
    expect(html).toContain("ไม่มีข้อมูล");
  });

  it("adjusts group spans and keeps the TikTok account / Edit column when other columns are hidden", () => {
    const onlyCost = renderToStaticMarkup(<CreatorOverviewTableView rows={[base]} hidden={new Set([
      "scheduleTime", "autoBudget", "totalBudgetMinor", "maxBudgetMinor", "viewerBoostBudgetMinor", "roiTarget", "gmvMinor",
      "skuOrders", "costPerOrderMinor", "liveViews", "costPerLiveViewMinor",
    ])} sort={{ key: "costMinor", direction: "descending" }} onEdit={() => {}} onSort={() => {}} />);
    expect(onlyCost.match(/scope="colgroup"/g)).toHaveLength(1);
    expect(onlyCost).toContain('colSpan="1"');
    expect(onlyCost).toContain('aria-sort="descending"');
    expect(onlyCost).toContain('aria-label="Cost: เรียงน้อยไปมาก (ASC)"');
    expect(onlyCost).toContain('aria-label="Edit Creator 1"');
    expect(onlyCost).not.toContain("Schedule time");

    const onlyAccount = renderToStaticMarkup(<CreatorOverviewTableView rows={[base]} hidden={new Set([
      "scheduleTime", "autoBudget", "totalBudgetMinor", "maxBudgetMinor", "viewerBoostBudgetMinor", "roiTarget", "costMinor", "gmvMinor",
      "skuOrders", "costPerOrderMinor", "liveViews", "costPerLiveViewMinor",
    ])} sort={{ key: "displayName", direction: "ascending" }} onEdit={() => {}} onSort={() => {}} />);
    expect(onlyAccount).not.toContain('scope="colgroup"');
    expect(onlyAccount).not.toContain("rowSpan");
    expect(onlyAccount).toContain('aria-label="Edit Creator 1"');
  });
});
