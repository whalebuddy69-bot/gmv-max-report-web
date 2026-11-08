import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, ChevronDown, Columns3, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BANGKOK } from "@/lib/automation";
import type { CreatorOverviewRow } from "@/lib/creatorOverview";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

const groups = [
  {
    id: "setup", label: "Setup", columns: [
      { id: "scheduleTime", label: "Schedule time", description: "กำหนดการ (เวลาไทย)" },
      { id: "autoBudget", label: "Auto budget increase", description: "สถานะเพิ่มงบอัตโนมัติ" },
      { id: "totalBudgetMinor", label: "Total Budget", description: "งบที่ตั้งไว้", format: "money" },
      { id: "maxBudgetMinor", label: "Max budget", description: "เพดานงบต่อวัน", format: "money" },
      { id: "viewerBoostBudgetMinor", label: "Viewer boost budget", description: "งบเพิ่มผู้ชม", format: "money" },
      { id: "roiTarget", label: "ROI Target", description: "เป้าหมาย ROI", format: "ratio" },
    ],
  },
  {
    id: "performance", label: "Performance", columns: [
      { id: "costMinor", label: "Cost", description: "ค่าโฆษณา", format: "money" },
      { id: "gmvMinor", label: "GMV", description: "มูลค่ายอดขาย", format: "money" },
      { id: "skuOrders", label: "SKU Order", description: "ออเดอร์ SKU", format: "integer" },
      { id: "costPerOrderMinor", label: "Cost per order", description: "ค่าโฆษณาต่อออเดอร์", format: "money" },
      { id: "liveViews", label: "LIVE views", description: "ยอดชม LIVE", format: "integer" },
      { id: "costPerLiveViewMinor", label: "Cost per LIVE view", description: "ค่าโฆษณาต่อยอดชม LIVE", format: "money" },
    ],
  },
] as const;

type Group = (typeof groups)[number];
type Column = Group["columns"][number];
type ColumnId = Column["id"];
type SortKey = "displayName" | ColumnId;
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

function sortValue(row: CreatorOverviewRow, key: Exclude<SortKey, "displayName">): number | null {
  if (key === "autoBudget") return row.autoBudget === null ? null : autoStates[row.autoBudget].order;
  const value = key === "scheduleTime" ? Date.parse(row.scheduleTime?.startAt ?? "") : row[key];
  return value !== null && Number.isFinite(value) ? value : null;
}

function byIdentity(a: CreatorOverviewRow, b: CreatorOverviewRow): number {
  return names.compare(a.displayName, b.displayName) || a.clientId.localeCompare(b.clientId);
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
    <span className="block text-[11px] text-muted-foreground">{startDate}</span>
  </>;
  const endDate = scheduleDay.format(end);
  const endClock = scheduleClock.format(end);
  if (startDate === endDate) return <>
    <span className="block font-medium">{startClock}–{endClock}</span>
    <span className="block text-[11px] text-muted-foreground">{startDate}</span>
  </>;
  return <>
    <span className="block">{startDate} {startClock}</span>
    <span className="block text-muted-foreground">ถึง {endDate} {endClock}</span>
  </>;
}

function Cell({ column, row }: { column: Column; row: CreatorOverviewRow }) {
  if (column.id === "scheduleTime") return <Schedule schedule={row.scheduleTime} />;
  if (column.id === "autoBudget") {
    if (row.autoBudget === null) return <NoValue />;
    const { label, variant } = autoStates[row.autoBudget];
    return <Badge variant={variant}>{label}</Badge>;
  }
  const value = row[column.id];
  if (value === null || !Number.isFinite(value)) return <NoValue />;
  if (column.format === "money") return formatValue(value / 100, "currency");
  if (column.format === "ratio") return `${formatValue(value, "ratio")}×`;
  return formatValue(value, "integer");
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
    className="inline-flex min-h-9 items-center justify-start gap-1.5 rounded px-1 py-1 text-start font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
  >
    {label}<Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-foreground" : "text-muted-foreground")} />
  </button>;
}

const accessLabels: Record<CreatorOverviewRow["access"], { label: string; title: string }> = {
  verified: { label: "ยืนยันสิทธิ์แล้ว", title: "ตรวจสอบสิทธิ์เข้าถึงบัญชีแล้ว" },
  stale: { label: "ข้อมูลอาจล่าช้า", title: "ข้อมูลเข้าถึงบัญชียังไม่อัปเดต" },
  unavailable: { label: "ยังเข้าถึงไม่ได้", title: "ยังตรวจสอบสิทธิ์เข้าถึงบัญชีไม่ได้" },
};

function Identity({ row, onEdit }: { row: CreatorOverviewRow; onEdit: (clientId: string) => void }) {
  const access = accessLabels[row.access];
  return <>
    <span className="block truncate font-semibold" title={row.displayName}>{row.displayName}</span>
    <span className="block text-[10px] font-normal text-muted-foreground tabular" title={row.tiktokAccountId}>{row.tiktokAccountId}</span>
    <span className="block text-[10px] font-normal text-muted-foreground" title={access.title}>
      {row.active === true && <span className="font-semibold text-emerald-700" title={row.campaignName ?? undefined}>เปิดแคมเปญ · </span>}{access.label}
    </span>
    <Button type="button" variant="outline" size="sm" className="mt-1.5 h-8 gap-1.5 px-2" aria-label={`Edit ${row.displayName}`} onClick={() => onEdit(row.clientId)}>
      <Pencil aria-hidden="true" className="h-3 w-3" /> Edit
    </Button>
  </>;
}

const frozenCell = "sticky left-0 border-r bg-card shadow-[2px_0_4px_0_rgba(15,23,42,0.05)]";

export function CreatorOverviewTableView({ rows, hidden, sort, onEdit, onSort }: {
  rows: readonly CreatorOverviewRow[];
  hidden: ReadonlySet<ColumnId>;
  sort: CreatorOverviewTableSort;
  onEdit: (clientId: string) => void;
  onSort: (key: SortKey) => void;
}) {
  const visibleGroups = groups.map((group) => ({ ...group, columns: group.columns.filter((column) => !hidden.has(column.id)) }))
    .filter(({ columns }) => columns.length > 0);
  const visibleColumns = visibleGroups.flatMap((group) => group.columns);
  const groupStarts = new Set(visibleGroups.map(({ columns }) => columns[0]?.id));
  const grouped = visibleGroups.length > 0;
  const header = (sortKey: SortKey, label: string, description?: string): ReactNode => <SortButton label={label} description={description} sortKey={sortKey} sort={sort} onSort={onSort} />;
  return <div role="region" aria-label="ตาราง Creator และผลโฆษณา" tabIndex={0} className="scrollbar-thin relative max-w-full overflow-x-auto overscroll-x-contain rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <table className="w-full table-auto border-separate border-spacing-0 text-left text-sm">
      <caption className="sr-only">ภาพรวมการตั้งค่าและผลโฆษณาแยกตาม Creator</caption>
      <colgroup><col className="w-36 sm:w-44" /></colgroup>
      {visibleGroups.map(({ id, columns }) => <colgroup key={id} span={columns.length} />)}
      <thead>
        <tr>
          <th scope="col" rowSpan={grouped ? 2 : undefined} aria-sort={sort.key === "displayName" ? sort.direction : undefined} className={cn(frozenCell, "z-20 min-w-36 border-b px-2 py-2 align-bottom sm:min-w-44 sm:px-3")}>
            {header("displayName", "TikTok account")}
            <span className="block px-1 text-[11px] font-normal text-muted-foreground">บัญชี / Edit</span>
          </th>
          {visibleGroups.map(({ id, label, columns }, index) => <th key={id} scope="colgroup" colSpan={columns.length} className={cn("border-b bg-muted/70 px-3 py-2 text-xs font-semibold", index > 0 && "border-l")}>
            {label}
          </th>)}
        </tr>
        {grouped && <tr>{visibleColumns.map((column) => <th key={column.id} scope="col" aria-sort={sort.key === column.id ? sort.direction : undefined}
          className={cn("min-w-28 border-b bg-card px-2 py-1 align-middle whitespace-nowrap", "format" in column && "text-right", groupStarts.has(column.id) && column.id !== visibleColumns[0]?.id && "border-l")}>
          {header(column.id, column.label, column.description)}
        </th>)}</tr>}
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.clientId} className="group">
          <th scope="row" className={cn(frozenCell, "z-10 border-b px-3 py-2 align-middle group-last:border-b-0")}>
            <div className="max-w-28 sm:max-w-36"><Identity row={row} onEdit={onEdit} /></div>
          </th>
          {visibleColumns.map((column) => <td key={column.id}
            className={cn("border-b px-3 py-2 align-middle whitespace-nowrap group-hover:bg-muted/35 group-last:border-b-0", "format" in column && "tabular text-right font-medium", groupStarts.has(column.id) && column.id !== visibleColumns[0]?.id && "border-l")}>
            <Cell column={column} row={row} />
          </td>)}
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={1 + visibleColumns.length} className="px-3 py-5 text-sm text-muted-foreground">ไม่พบ Creator ที่ตรงกับตัวกรอง</td></tr>}
      </tbody>
    </table>
  </div>;
}

export function CreatorOverviewTable({ rows, onEdit }: {
  rows: readonly CreatorOverviewRow[];
  onEdit: (clientId: string) => void;
}) {
  const [{ hidden, sort }, setPreferences] = useState<{ hidden: ReadonlySet<ColumnId>; sort: CreatorOverviewTableSort }>(() => ({ hidden: new Set(), sort: initialSort }));
  const sorted = useMemo(() => sortCreatorOverviewRows(rows, sort), [rows, sort]);
  const changeVisibility = (columns: readonly Column[], visible: boolean) => setPreferences((previous) => {
    const next = new Set(previous.hidden);
    for (const { id } of columns) {
      if (visible) next.delete(id);
      else next.add(id);
    }
    return { hidden: next, sort: previous.sort.key !== "displayName" && next.has(previous.sort.key) ? initialSort : previous.sort };
  });
  const onSort = (key: SortKey) => setPreferences((previous) => ({ ...previous, sort: { key, direction: previous.sort.key === key && previous.sort.direction === "ascending" ? "descending" : "ascending" } }));
  return <div className="min-w-0 space-y-2.5">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <p className="flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> เลื่อนซ้าย–ขวาเพื่อดูทุกคอลัมน์ · กดหัวตารางเพื่อเรียง</p>
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
          <p className="px-1 text-[11px] text-muted-foreground sm:col-span-2">TikTok account และ Edit แสดงเสมอ</p>
        </div>
      </details>
    </div>
    <CreatorOverviewTableView rows={sorted} hidden={hidden} sort={sort} onEdit={onEdit} onSort={onSort} />
  </div>;
}
