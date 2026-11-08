import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, ChevronDown, Columns3 } from "lucide-react";
import type { AutomationCampaignToday } from "@/api/automationCampaignsToday";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BANGKOK } from "@/lib/automation";
import type { CreatorOverviewRow } from "@/lib/creatorOverview";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

const statusColumn = { id: "status", label: "Status", description: "Live หมายถึงแคมเปญเปิดอยู่ ไม่ได้ยืนยันว่าห้องกำลัง LIVE" } as const;
const groups = [
  {
    id: "setup", label: "Setup", columns: [
      { id: "viewerBoostBudgetMinor", label: "Viewer Boost", description: "งบเพิ่มผู้ชม", format: "money" },
      { id: "scheduleTime", label: "Schedule time", description: "กำหนดการ (เวลาไทย)" },
      { id: "autoBudget", label: "Auto budget increase", description: "สถานะเพิ่มงบอัตโนมัติ" },
      { id: "totalBudgetMinor", label: "Total Budget", description: "งบที่ตั้งไว้", format: "money" },
      { id: "maxBudgetMinor", label: "Max budget", description: "เพดานงบต่อวัน", format: "money" },
      { id: "roiTarget", label: "ROI Target", description: "เป้าหมาย ROI", format: "ratio" },
    ],
  },
  {
    id: "performance", label: "Performance", columns: [
      { id: "costMinor", label: "Cost", description: "ค่าโฆษณา", format: "money" },
      { id: "gmvMinor", label: "GMV", description: "มูลค่ายอดขาย", format: "money" },
      { id: "roiActual", label: "ROI", description: "ROI จริง: GMV ÷ ค่าโฆษณา", format: "ratio" },
      { id: "skuOrders", label: "SKU Order", description: "ออเดอร์ SKU", format: "integer" },
      { id: "costPerOrderMinor", label: "Cost per order", description: "ค่าโฆษณาต่อออเดอร์", format: "money" },
      { id: "liveViews", label: "LIVE views", description: "ยอดชม LIVE", format: "integer" },
      { id: "costPerLiveViewMinor", label: "Cost per LIVE view", description: "ค่าโฆษณาต่อยอดชม LIVE", format: "money" },
    ],
  },
] as const;

type Group = (typeof groups)[number];
type OptionalColumn = Group["columns"][number];
type Column = typeof statusColumn | OptionalColumn;
type OptionalColumnId = OptionalColumn["id"];
type SortKey = "displayName" | Column["id"];
export type CreatorOverviewTableSort = { key: SortKey; direction: "ascending" | "descending" };
const initialSort: CreatorOverviewTableSort = { key: "displayName", direction: "ascending" };
const names = new Intl.Collator("th", { numeric: true, sensitivity: "base" });
const scheduleDay = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, day: "numeric", month: "short", year: "numeric" });
const scheduleClock = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const autoStates = {
  off: { order: 0, label: "ปิด", variant: "outline" },
  blocked: { order: 1, label: "พัก · ต้องตรวจสอบ", variant: "warning" },
  pending: { order: 2, label: "กำลังตรวจสอบ", variant: "warning" },
  on: { order: 3, label: "เปิด", variant: "success" },
} as const;
const badgeClass = "px-1.5 py-0 text-[10px] leading-4";

function divideMetric(numerator: number | null | undefined, denominator: number | null | undefined) {
  return numerator != null && denominator != null && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator : null;
}

function sortValue(row: CreatorOverviewRow, key: Exclude<SortKey, "displayName">): number | null {
  if (key === "status") return row.active === null ? null : Number(row.active);
  if (key === "autoBudget") return row.autoBudget === null ? null : autoStates[row.autoBudget].order;
  if (key === "roiActual") return row.roiActual != null && Number.isFinite(row.roiActual) ? row.roiActual : null;
  const value = key === "scheduleTime" ? Date.parse(row.scheduleTime?.startAt ?? "") : row[key];
  return value !== null && Number.isFinite(value) ? value : null;
}

function accountName(row: CreatorOverviewRow): string {
  return row.tiktokUsername ? `@${row.tiktokUsername.replace(/^@/, "")}` : row.displayName;
}

function byIdentity(a: CreatorOverviewRow, b: CreatorOverviewRow): number {
  return names.compare(accountName(a), accountName(b)) || a.clientId.localeCompare(b.clientId);
}

/** Unknown values stay below known ones in both directions; ties remain predictable after refresh. */
export function sortCreatorOverviewRows(rows: readonly CreatorOverviewRow[], sort: CreatorOverviewTableSort): CreatorOverviewRow[] {
  const direction = sort.direction === "ascending" ? 1 : -1;
  const key = sort.key;
  return [...rows].sort((a, b) => {
    if (key === "displayName") return direction * byIdentity(a, b);
    const first = sortValue(a, key);
    const second = sortValue(b, key);
    if (first === null || second === null) return first === second ? byIdentity(a, b) : first === null ? 1 : -1;
    return direction * (first - second) || byIdentity(a, b);
  });
}

function NoValue() {
  return <span className="text-muted-foreground"><span aria-hidden="true">–</span><span className="sr-only">ไม่มีข้อมูล</span></span>;
}

function Schedule({ schedule }: { schedule: CreatorOverviewRow["scheduleTime"] }) {
  if (!schedule) return <NoValue />;
  const start = new Date(schedule.startAt);
  const end = schedule.endAt === null ? null : new Date(schedule.endAt);
  if (!Number.isFinite(start.getTime())) return <NoValue />;
  const startDate = scheduleDay.format(start);
  const startClock = scheduleClock.format(start);
  if (end === null || !Number.isFinite(end.getTime())) return <>
    <span className="block font-medium">เริ่ม {startClock}</span>
    <span className="block text-[10px] text-muted-foreground">{startDate}</span>
  </>;
  const endDate = scheduleDay.format(end);
  const endClock = scheduleClock.format(end);
  if (startDate === endDate) return <>
    <span className="block font-medium">{startClock}–{endClock}</span>
    <span className="block text-[10px] text-muted-foreground">{startDate}</span>
  </>;
  return <>
    <span className="block">{startDate} {startClock}</span>
    <span className="block text-muted-foreground">ถึง {endDate} {endClock}</span>
  </>;
}

function NumericCell({ column, value }: { column: Extract<OptionalColumn, { format: string }>; value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <NoValue />;
  if (column.format === "money") return formatValue(value / 100, "currency");
  if (column.format === "ratio") return `${formatValue(value, "ratio")}×`;
  return formatValue(value, "integer");
}

function Cell({ column, row }: { column: Column; row: CreatorOverviewRow }) {
  if (column.id === "status") {
    const label = row.active === true ? "Live" : row.active === false ? "Off" : "—";
    const title = row.active === true ? column.description : row.active === false ? "ไม่พบแคมเปญที่เปิดอยู่" : "ยังยืนยันสถานะไม่ได้";
    return <Badge className={badgeClass} variant={row.active === true ? "success" : "outline"} title={title} aria-label={`${label}: ${title}`}>{label}</Badge>;
  }
  if (column.id === "scheduleTime") return <Schedule schedule={row.scheduleTime} />;
  if (column.id === "autoBudget") {
    if (row.autoBudget === null) return <NoValue />;
    const { label, variant } = autoStates[row.autoBudget];
    return <Badge className={badgeClass} variant={variant}>{label}</Badge>;
  }
  return <NumericCell column={column} value={row[column.id]} />;
}

function SortButton({ label, description, sortKey, sort, onSort }: {
  label: string;
  description?: string;
  sortKey: SortKey;
  sort: CreatorOverviewTableSort;
  onSort: (key: SortKey) => void;
}) {
  const selected = sort.key === sortKey;
  const Icon = !selected ? ArrowUpDown : sort.direction === "ascending" ? ArrowUp : ArrowDown;
  const nextLabel = selected && sort.direction === "ascending" ? "มากไปน้อย (DESC)" : "น้อยไปมาก (ASC)";
  return <button
    type="button"
    title={description}
    aria-label={`${label}: เรียง${nextLabel}`}
    onClick={() => onSort(sortKey)}
    className="inline-flex min-h-8 max-w-full items-center justify-start gap-0.5 rounded px-0.5 py-0.5 text-start leading-tight font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring sm:gap-1"
  >
    <span className="min-w-0">{label}</span><Icon aria-hidden="true" className={cn("size-3 shrink-0", selected ? "text-foreground" : "text-muted-foreground")} />
  </button>;
}

const accessLabels: Record<CreatorOverviewRow["access"], { label: string; title: string }> = {
  verified: { label: "ยืนยันสิทธิ์แล้ว", title: "ตรวจสอบสิทธิ์เข้าถึงบัญชีแล้ว" },
  stale: { label: "ข้อมูลอาจล่าช้า", title: "ข้อมูลเข้าถึงบัญชียังไม่อัปเดต" },
  unavailable: { label: "ยังเข้าถึงไม่ได้", title: "ยังตรวจสอบสิทธิ์เข้าถึงบัญชีไม่ได้" },
};

function Identity({ row, expanded, panelId, onToggleExpand }: {
  row: CreatorOverviewRow;
  expanded: boolean;
  panelId: string;
  onToggleExpand: (clientId: string) => void;
}) {
  const access = accessLabels[row.access];
  const name = accountName(row);
  return <button type="button" aria-label={`${expanded ? "ย่อ" : "ขยาย"}แคมเปญของ ${name}`} aria-expanded={expanded}
    aria-controls={expanded ? panelId : undefined} onClick={() => onToggleExpand(row.clientId)}
    className={cn("grid min-h-9 w-full min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-0.5 rounded-md px-0.5 py-0.5 text-start hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring sm:gap-1", expanded && "bg-muted/70")}>
    <ChevronDown className={cn("size-3 text-muted-foreground transition-transform motion-reduce:transition-none", !expanded && "-rotate-90")} aria-hidden />
    <span className="min-w-0">
      <span className="block truncate text-[11px] font-semibold sm:text-xs" title={row.tiktokUsername ? name : `${name} · ยังไม่ยืนยันชื่อผู้ใช้ TikTok`}>{name}</span>
      <span className="block truncate font-mono text-[9px] font-normal text-muted-foreground tabular sm:text-[10px]" title={row.tiktokAccountId}>{row.tiktokAccountId}</span>
      <span className="sr-only">{access.label}</span>
    </span>
  </button>;
}

const frozenAccount = "sticky left-0 border-r bg-card";
const frozenStatus = "sticky left-[var(--overview-account-width)] border-r bg-card shadow-[2px_0_4px_0_rgba(15,23,42,0.08)]";
const accountCell = "z-10 border-b px-1 py-0.5 align-middle sm:px-2";
const statusCell = "z-10 border-b px-1 py-0.5 align-middle sm:px-1.5";

export type CreatorOverviewExpansionLayout = {
  panelId: string;
  totalColumns: number;
  columns: readonly OptionalColumn[];
  groupStarts: ReadonlySet<OptionalColumnId>;
};

function metricCellClass(column: OptionalColumn, { columns, groupStarts }: CreatorOverviewExpansionLayout) {
  return cn("border-b px-1.5 py-1 align-middle break-words group-hover:bg-muted/35 sm:px-2",
    "format" in column && "tabular text-right font-medium", groupStarts.has(column.id) && column.id !== columns[0]?.id && "border-l");
}

/** A toolbar/notice sits in a single full-width row while the campaigns below share the real table columns. */
export function CreatorOverviewExpansionRow({ layout, anchor = false, children }: {
  layout: CreatorOverviewExpansionLayout;
  anchor?: boolean;
  children: ReactNode;
}) {
  return <tr data-overview-row="campaign-toolbar">
    <td colSpan={layout.totalColumns} className="border-b bg-muted/35 p-0">
      <div id={anchor ? layout.panelId : undefined} className="sticky left-0 min-w-0 max-w-full px-2.5 py-2 [width:100cqi] sm:px-3">
        {children}
      </div>
    </td>
  </tr>;
}

type CampaignDetail = Omit<AutomationCampaignToday, "scheduleStartAt" | "scheduleEndAt"> & {
  scheduleStartAt?: string | null;
  scheduleEndAt?: string | null;
};

function CampaignMetricCell({ column, campaign }: { column: OptionalColumn; campaign: CampaignDetail }) {
  if (column.id === "scheduleTime") {
    return <Schedule schedule={campaign.scheduleStartAt ? { startAt: campaign.scheduleStartAt, endAt: campaign.scheduleEndAt ?? null } : null} />;
  }
  if (column.id === "autoBudget" || column.id === "maxBudgetMinor") return <NoValue />;
  const value = (() => {
    switch (column.id) {
      case "viewerBoostBudgetMinor": return campaign.viewerBoostBudgetMinor;
      case "totalBudgetMinor": return campaign.dailyBudgetMinor;
      case "roiTarget": return campaign.targetRoi;
      case "costMinor": return campaign.spendMinor;
      case "gmvMinor": return campaign.gmvMinor;
      case "roiActual": return campaign.roi;
      case "skuOrders": return campaign.skuOrders;
      case "liveViews": return campaign.liveViews;
      case "costPerOrderMinor": return divideMetric(campaign.spendMinor, campaign.skuOrders);
      case "costPerLiveViewMinor": return divideMetric(campaign.spendMinor, campaign.liveViews);
    }
  })();
  return <NumericCell column={column} value={value} />;
}

export function CreatorCampaignAlignedRows<Campaign extends CampaignDetail>({ layout, rows, now, renderIdentity }: {
  layout: CreatorOverviewExpansionLayout;
  rows: readonly Campaign[];
  now: number;
  renderIdentity: (campaign: Campaign) => ReactNode;
}) {
  return <>{rows.map((campaign) => {
    const isEnabled = campaign.operationStatus === "ENABLE";
    const ended = isEnabled && campaign.scheduleEndAt != null && Date.parse(campaign.scheduleEndAt) <= now;
    const live = isEnabled && !ended;
    const status = campaign.operationStatus === "DELETE" ? "ลบแล้ว" : ended ? "จบแล้ว" : live ? "Live" : "ปิด";
    return <tr key={campaign.campaignId} className="group bg-muted/20" data-overview-row="campaign">
      <th scope="row" className={cn(frozenAccount, accountCell, "font-normal")}>
        {renderIdentity(campaign)}
      </th>
      <td className={cn(frozenStatus, statusCell)} data-column="status">
        <Badge className={badgeClass} variant={live ? "success" : "outline"} title={live ? statusColumn.description : undefined}>{status}</Badge>
      </td>
      {layout.columns.map((column) => <td key={column.id} className={metricCellClass(column, layout)} data-column={column.id}>
        <CampaignMetricCell column={column} campaign={campaign} />
      </td>)}
    </tr>;
  })}</>;
}

type CreatorOverviewTableProps = {
  rows: readonly CreatorOverviewRow[];
  expanded: ReadonlySet<string>;
  onToggleExpand: (clientId: string) => void;
  renderExpanded: (row: CreatorOverviewRow, layout: CreatorOverviewExpansionLayout) => ReactNode;
};

export function CreatorOverviewTableView({ rows, hidden, sort, expanded, onToggleExpand, renderExpanded, onSort }: CreatorOverviewTableProps & {
  hidden: ReadonlySet<OptionalColumnId>;
  sort: CreatorOverviewTableSort;
  onSort: (key: SortKey) => void;
}) {
  const panelPrefix = useId();
  const visibleGroups = groups.map((group) => ({ ...group, columns: group.columns.filter((column) => !hidden.has(column.id)) }))
    .filter(({ columns }) => columns.length > 0);
  const visibleColumns = visibleGroups.flatMap((group) => group.columns);
  const totalColumns = 2 + visibleColumns.length;
  const groupStarts = new Set(visibleGroups.flatMap(({ columns }) => columns[0] ? [columns[0].id] : []));
  const header = (sortKey: SortKey, label: string, description?: string): ReactNode => <SortButton label={label} description={description} sortKey={sortKey} sort={sort} onSort={onSort} />;
  const hasGroups = visibleColumns.length > 0;
  return <div role="region" aria-label="ตาราง Creator และผลโฆษณา" tabIndex={0}
    className="scrollbar-thin relative w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-lg border [container-type:inline-size] [--overview-account-width:7.125rem] [--overview-status-width:3.625rem] [--overview-metric-width:6.125rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:[--overview-account-width:8.75rem] sm:[--overview-status-width:4.25rem] sm:[--overview-metric-width:7rem]">
    <table className="table-fixed border-separate border-spacing-0 text-left text-[11px] leading-snug sm:text-xs"
      style={{ width: `max(100%, calc(var(--overview-account-width) + var(--overview-status-width) + ${visibleColumns.length} * var(--overview-metric-width)))` }}>
      <caption className="sr-only">ภาพรวมการตั้งค่าและผลโฆษณาแยกตาม Creator</caption>
      {/* With fixed layout only unspecified optional columns receive surplus width.
          When both pins are the only columns, Status takes the remainder. */}
      <colgroup><col className="w-[var(--overview-account-width)]" /><col className={hasGroups ? "w-[var(--overview-status-width)]" : undefined} /></colgroup>
      {visibleGroups.map(({ id, columns }) => <colgroup key={id} span={columns.length} />)}
      <thead>
        <tr>
          <th scope="col" rowSpan={hasGroups ? 2 : undefined} aria-sort={sort.key === "displayName" ? sort.direction : undefined} className={cn(frozenAccount, "z-20 border-b px-1.5 py-0.5 align-middle sm:px-2")}>
            {header("displayName", "TikTok account")}
          </th>
          <th scope="col" rowSpan={hasGroups ? 2 : undefined} aria-sort={sort.key === "status" ? sort.direction : undefined} data-column="status" className={cn(frozenStatus, "z-20 border-b px-1 py-0.5 align-middle sm:px-1.5")}>
            {header("status", statusColumn.label, statusColumn.description)}
          </th>
          {visibleGroups.map(({ id, label, columns }, index) => <th key={id} scope="colgroup" colSpan={columns.length} className={cn("border-b bg-muted/70 px-2 py-1 text-[10px] font-semibold sm:text-[11px]", index > 0 && "border-l")}>
            {label}
          </th>)}
        </tr>
        {hasGroups && <tr>{visibleColumns.map((column) => <th key={column.id} scope="col" aria-sort={sort.key === column.id ? sort.direction : undefined} data-column={column.id}
          className={cn("border-b bg-card px-1.5 py-0.5 align-middle sm:px-2", "format" in column && "text-right", groupStarts.has(column.id) && column.id !== visibleColumns[0]?.id && "border-l")}>
          {header(column.id, column.label, column.description)}
        </th>)}</tr>}
      </thead>
      <tbody>
        {rows.map((row) => {
          const isExpanded = expanded.has(row.clientId);
          const panelId = `${panelPrefix}-campaigns-${row.clientId}`;
          const layout = { panelId, totalColumns, columns: visibleColumns, groupStarts };
          return <Fragment key={row.clientId}>
            <tr className="group" data-overview-row="account">
              <th scope="row" className={cn(frozenAccount, accountCell, "group-last:border-b-0")}>
                <Identity row={row} expanded={isExpanded} panelId={panelId} onToggleExpand={onToggleExpand} />
              </th>
              <td className={cn(frozenStatus, statusCell, "group-last:border-b-0")} data-column="status">
                <Cell column={statusColumn} row={row} />
              </td>
              {visibleColumns.map((column) => <td key={column.id}
                className={cn(metricCellClass(column, layout), "group-last:border-b-0")} data-column={column.id}>
                <Cell column={column} row={row} />
              </td>)}
            </tr>
            {isExpanded && renderExpanded(row, layout)}
          </Fragment>;
        })}
        {rows.length === 0 && <tr><td colSpan={totalColumns} className="px-3 py-4 text-xs text-muted-foreground">ไม่พบ Creator ที่ตรงกับตัวกรอง</td></tr>}
      </tbody>
    </table>
  </div>;
}

export function CreatorOverviewTable({ rows, expanded, onToggleExpand, renderExpanded }: CreatorOverviewTableProps) {
  const [{ hidden, sort }, setPreferences] = useState<{ hidden: ReadonlySet<OptionalColumnId>; sort: CreatorOverviewTableSort }>(() => ({ hidden: new Set(), sort: initialSort }));
  const sorted = useMemo(() => sortCreatorOverviewRows(rows, sort), [rows, sort]);
  const changeVisibility = (columns: readonly OptionalColumn[], visible: boolean) => setPreferences((previous) => {
    const next = new Set(previous.hidden);
    for (const { id } of columns) {
      if (visible) next.delete(id);
      else next.add(id);
    }
    return { hidden: next, sort: previous.sort.key !== "displayName" && previous.sort.key !== "status" && next.has(previous.sort.key) ? initialSort : previous.sort };
  });
  const onSort = (key: SortKey) => setPreferences((previous) => ({ ...previous, sort: { key, direction: previous.sort.key === key && previous.sort.direction === "ascending" ? "descending" : "ascending" } }));
  return <div className="min-w-0 space-y-2.5">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <p className="flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> กดชื่อบัญชีเพื่อดูแคมเปญ · เลื่อนซ้าย–ขวาเพื่อดูทุกคอลัมน์</p>
      <details className="group/columns grow sm:grow-0">
        <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <Columns3 aria-hidden="true" className="h-4 w-4" /> คอลัมน์
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 group-open/columns:rotate-180" />
        </summary>
        <div className="mt-2 grid gap-2 rounded-lg border bg-card p-2.5 sm:grid-cols-2">
          {groups.map(({ id, label, columns }) => {
            const allShown = columns.every((column) => !hidden.has(column.id));
            return <fieldset key={id} className="grid min-w-0 grid-cols-2 gap-x-1 rounded-md border px-2.5 pb-1.5 sm:grid-cols-1">
              <legend className="px-1 text-xs font-semibold">{label}</legend>
              <Button type="button" size="sm" variant="ghost" className="col-span-full my-0.5 h-8 w-fit px-1.5 text-xs"
                aria-label={`${allShown ? "ซ่อน" : "แสดง"}คอลัมน์ทั้งหมดใน ${label}`}
                onClick={() => changeVisibility(columns, !allShown)}>{allShown ? "ซ่อนทั้งกลุ่ม" : "แสดงทั้งกลุ่ม"}</Button>
              {columns.map((column) => <label key={column.id} className="flex min-h-8 cursor-pointer items-center gap-2 px-1.5 text-xs">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={!hidden.has(column.id)} onChange={(event) => changeVisibility([column], event.currentTarget.checked)} /> {column.label}
              </label>)}
            </fieldset>;
          })}
          <p className="px-1 text-[11px] text-muted-foreground sm:col-span-2">TikTok account และ Status แสดงเสมอ</p>
        </div>
      </details>
    </div>
    <CreatorOverviewTableView rows={sorted} hidden={hidden} sort={sort} expanded={expanded} onToggleExpand={onToggleExpand} renderExpanded={renderExpanded} onSort={onSort} />
  </div>;
}
