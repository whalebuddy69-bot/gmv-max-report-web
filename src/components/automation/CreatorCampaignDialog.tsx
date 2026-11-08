import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Pencil, Plus, RefreshCw } from "lucide-react";
import { PILOT_BUDGET_CLIENT_ID, type AutomationClient, type AutomationOverview } from "@/api/automation";
import { fetchAutomationCampaignsToday, type AutomationCampaignToday, type AutomationCampaignsToday } from "@/api/automationCampaignsToday";
import { isBudgetCapClientId } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { bangkokDay, isFreshAutomationClient } from "@/lib/automation";
import { formatBudgetBaht, parseBudgetBaht } from "@/lib/automationBudget";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AutoBudgetStatusPanel } from "./AutoBudgetStatusPanel";
import { CampaignControlPanel, hasPendingCampaignOperation, parseCampaignRoiTenths } from "./CampaignControlPanel";
import { CreatorCampaignEditPanel, CreatorCampaignFormSection } from "./CreatorOverviewEdit";

type DialogProps = {
  client: AutomationClient;
  userId: number;
  now: number;
  onRefreshCampaign: () => void;
  onSync: () => Promise<AutomationOverview | null>;
};
type Row = Omit<AutomationCampaignToday, "scheduleStartAt" | "scheduleEndAt"> & { scheduleStartAt?: string | null; scheduleEndAt?: string | null };
type Screen = { type: "edit"; id: string } | { type: "create" } | { type: "recovery" } | { type: "lifecycle"; row: Row; action: "PAUSE" | "RESUME" };
const numericCampaign = /^[1-9]\d{5,30}$/;

export function campaignsTodayForClient(data: AutomationCampaignsToday | undefined, client: AutomationClient, now: number) {
  if (!data || data.clientId !== client.clientId || data.reportingDate !== bangkokDay(now) || data.coverage === "unavailable" || !data.observedAt) return null;
  const age = now - Date.parse(data.observedAt);
  return age >= -30_000 && age <= 300_000 ? data : null;
}

function overviewFallback(client: AutomationClient, now: number): Row[] {
  const campaign = isFreshAutomationClient(client, now) ? client.campaign : null;
  if (!campaign) return [];
  return [{ campaignId: campaign.campaignId, campaignName: campaign.campaignName, operationStatus: "ENABLE",
    dailyBudgetMinor: campaign.dailyBudgetMinor, targetRoi: campaign.targetRoi, spendMinor: campaign.spendMinor, gmvMinor: null,
    viewerBoostBudgetMinor: campaign.viewerBoostBudgetMinor,
    roi: null, activityToday: (campaign.spendMinor ?? 0) > 0,
    scheduleStartAt: campaign.scheduleStartAt, scheduleEndAt: campaign.scheduleEndAt }];
}

export function endedTodayRow(row: Row, now: number) {
  return row.operationStatus !== "ENABLE" || (row.scheduleEndAt != null && Date.parse(row.scheduleEndAt) <= now);
}

export function allowedLifecycleIntent(row: Row, clientId: string, hasEnabled: boolean, now: number) {
  if (clientId !== PILOT_BUDGET_CLIENT_ID || !numericCampaign.test(row.campaignId) || row.operationStatus === "DELETE" ||
      (row.scheduleEndAt != null && Date.parse(row.scheduleEndAt) <= now)) return null;
  if (row.operationStatus === "ENABLE") return "PAUSE";
  return hasEnabled ? null : "RESUME";
}

export function visibleCampaignBreakdown(rows: readonly Row[], now: number) {
  // Keep an enabled campaign available to manage even if it has not spent yet.
  // For closed/ended rows only include verified positive cost for this report day.
  return rows.filter((row) => !endedTodayRow(row, now) || (row.spendMinor ?? 0) > 0)
    .sort((a, b) => Number(endedTodayRow(a, now)) - Number(endedTodayRow(b, now)) ||
      (b.spendMinor ?? -1) - (a.spendMinor ?? -1) || a.campaignId.localeCompare(b.campaignId));
}

function CampaignToggle({ row, action, onLifecycle }: {
  row: Row; action: "PAUSE" | "RESUME" | null; onLifecycle: (row: Row, action: "PAUSE" | "RESUME", source: HTMLButtonElement) => void;
}) {
  const enabled = row.operationStatus === "ENABLE";
  return <button type="button" role="switch" aria-label={`${enabled ? "ปิด" : "เปิดอีกครั้ง"} ${row.campaignName}`} aria-checked={enabled} disabled={!action}
    title={!action ? "ยังสลับสถานะรายการนี้จากเว็บไม่ได้" : "เปิดหน้าตรวจและยืนยัน"}
    onClick={(event) => { if (action) onLifecycle(row, action, event.currentTarget); }}
    className="inline-flex h-11 items-center rounded-md px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45">
    <span aria-hidden className={cn("relative block h-5 w-9 rounded-full", enabled ? "bg-primary" : "bg-muted-foreground/45")}>
      <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm", enabled && "translate-x-4")} />
    </span>
  </button>;
}

const metricColumns = ["Viewer Boost", "Cost", "GMV", "ROI", "SKU Orders", "Cost / Order", "LIVE Views", "Cost / LIVE View"] as const;

function breakdownCells(row: Row) {
  const money = (value: number | null | undefined) => value == null ? "—" : formatValue(value / 100, "currency");
  const count = (value: number | null | undefined) => value == null ? "—" : formatValue(value, "integer");
  const unit = (n: number | null | undefined) => row.spendMinor !== null && n != null && n > 0 ? money(row.spendMinor / n) : "—";
  return [money(row.viewerBoostBudgetMinor), money(row.spendMinor), money(row.gmvMinor), row.roi === null ? "—" : `${formatValue(row.roi, "ratio")}×`,
    count(row.skuOrders), unit(row.skuOrders), count(row.liveViews), unit(row.liveViews)];
}

export function CreatorCampaignBreakdownTable({ rows, clientId, now, onEdit, onLifecycle }: {
  rows: readonly Row[]; clientId: string; now: number;
  onEdit: (row: Row, source: HTMLButtonElement) => void; onLifecycle: (row: Row, action: "PAUSE" | "RESUME", source: HTMLButtonElement) => void;
}) {
  const visible = visibleCampaignBreakdown(rows, now);
  const hasEnabled = rows.some((row) => row.operationStatus === "ENABLE");
  return <div role="region" aria-label="ผลแยกรายแคมเปญ" tabIndex={0} className="relative min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-md border bg-card focus-visible:outline-2 focus-visible:outline-ring">
    <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-[11px] sm:text-xs">
      <caption className="sr-only">แคมเปญที่เปิดหรือมี Cost วันนี้</caption>
      <thead className="bg-muted/40">
        <tr>
          <th scope="col" className="min-w-44 border-b px-2 py-1.5 text-left font-semibold">Campaign Name</th>
          <th scope="col" className="border-b px-2 py-1.5 text-center font-semibold">Status</th>
          {metricColumns.map((label) => <th key={label} scope="col" className="border-b px-2 py-1.5 text-right font-semibold" title={label === "Viewer Boost" ? "Viewer Boost Budget" : undefined}>{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {visible.map((row) => {
          const ended = endedTodayRow(row, now);
          const live = row.operationStatus === "ENABLE" && !ended;
          return <tr key={row.campaignId} className="group">
            <th scope="row" className="border-b px-1 py-1 text-left group-last:border-b-0">
              <div className="flex items-center gap-1">
                <CampaignToggle row={row} action={allowedLifecycleIntent(row, clientId, hasEnabled, now)} onLifecycle={onLifecycle} />
                <div className="min-w-0 max-w-48 sm:max-w-64">
                  <span className="block truncate text-xs font-semibold" title={row.campaignName}>{row.campaignName}</span>
                  <span className="block font-mono text-[10px] font-normal text-muted-foreground">ID {row.campaignId}</span>
                </div>
                <Button type="button" variant="ghost" size="sm" className="min-h-10 shrink-0 px-2" aria-label={`แก้ไข ${row.campaignName}`} onClick={(event) => onEdit(row, event.currentTarget)}>
                  <Pencil className="size-3.5" aria-hidden /><span className="hidden lg:inline">แก้ไข</span>
                </Button>
              </div>
            </th>
            <td className="border-b px-2 py-1 text-center group-last:border-b-0">
              <Badge className="px-1.5 py-0 text-[10px]" variant={live ? "success" : "outline"} title={live ? "แคมเปญเปิดอยู่ ไม่ใช่การยืนยันว่าห้องกำลัง LIVE" : undefined}>
                {row.operationStatus === "DELETE" ? "ลบแล้ว" : live ? "Live" : row.operationStatus === "ENABLE" ? "จบแล้ว" : "ปิด"}
              </Badge>
            </td>
            {breakdownCells(row).map((value, index) => <td key={metricColumns[index]} className="border-b px-2 py-1 text-right tabular-nums group-last:border-b-0">{value}</td>)}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

function OptionalAccountAuto({ client, userId }: { client: AutomationClient; userId: number }) {
  const [open, setOpen] = useState(false);
  if (!isBudgetCapClientId(client.clientId)) return null;
  return <details className="rounded-md border bg-card px-2.5" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="min-h-9 cursor-pointer py-2 text-xs font-medium">จัดการ Auto Budget ของบัญชี</summary>
    {open && <div className="pb-2"><AutoBudgetStatusPanel clientId={client.clientId} userId={userId} campaignId={null} variant="campaign-form" /></div>}
  </details>;
}

const viewerBoostHelp = "https://ads.tiktok.com/resources/help/article/how-to-set-up-live-gmv-viewer-boost";

function ViewerBoostInfo({ row }: { row: Row }) {
  return <section className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2" aria-label="Viewer Boost">
    <div className="min-w-0">
      <h3 className="text-sm font-semibold">Viewer Boost</h3>
      <p className="text-xs text-muted-foreground">{row.viewerBoostBudgetMinor == null ? "ยังไม่มีค่างบที่ยืนยันได้สำหรับแคมเปญนี้ · ไม่ใช่ 0 บาท" : `งบแยก: ${formatBudgetBaht(row.viewerBoostBudgetMinor)}`}</p>
    </div>
    <a href={viewerBoostHelp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-xs font-medium underline underline-offset-2">
      วิธีตั้งใน TikTok <ExternalLink className="size-3" aria-hidden />
    </a>
  </section>;
}

function CreateDraft({ current, onBack }: { current: Row | null; onBack: () => void }) {
  const [roi, setRoi] = useState("");
  const [budget, setBudget] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [setEndDate, setSetEndDate] = useState(false);
  const [notice, setNotice] = useState("");
  const roiId = useId();
  const budgetId = useId();
  const proposedRoi = parseCampaignRoiTenths(roi);
  const proposedBudget = parseBudgetBaht(budget);
  const invalidEnd = setEndDate && (!start || !end || end <= start);
  async function copyDraft() {
    if (proposedRoi === null || proposedBudget === null || invalidEnd) return;
    try {
      await navigator.clipboard.writeText([name.trim() ? `Campaign Name: ${name.trim()}` : null,
        `LIVE ROI Target: ${proposedRoi / 10}×`, `Daily budget: ${formatBudgetBaht(proposedBudget)}`,
        start ? `Start date (เวลาไทย): ${start.replace("T", " ")}` : null,
        start ? setEndDate ? `End date (เวลาไทย): ${end.replace("T", " ")}` : "End date: ไม่กำหนด" : null,
      ].filter(Boolean).join("\n"));
      setNotice("คัดลอกแบบร่างแล้ว · ยังไม่ได้สร้างแคมเปญ");
    } catch { setNotice("คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกจากช่องกรอก"); }
  }
  return <>
    <Back onBack={onBack} />
    <CreatorCampaignFormSection title="สร้างแคมเปญใหม่" tag="แบบร่าง">
      <p className="text-xs text-muted-foreground">เตรียมค่าได้ แต่ TikTok ยังไม่มี API ที่ยืนยันให้เว็บนี้สร้าง Creator LIVE GMV Max แบบไม่ผูก Shop ได้ จึงไม่มีการส่งคำสั่งหรือเปิดแคมเปญ</p>
      <p className="rounded-md bg-muted/55 px-2.5 py-1.5 text-xs">ROI จริงวันนี้ของแคมเปญปัจจุบัน: <strong>{current?.roi == null ? "—" : `${formatValue(current.roi, "ratio")}×`}</strong></p>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <div className="min-w-0">
          <label htmlFor={roiId} className="text-sm font-medium">LIVE ROI Target</label>
          <div className="relative mt-1"><Input id={roiId} type="text" className="h-11 pr-7 text-base sm:text-sm" inputMode="decimal" maxLength={5} value={roi} onChange={(event) => { setRoi(event.target.value); setNotice(""); }} />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">×</span></div>
        </div>
        <div className="min-w-0">
          <label htmlFor={budgetId} className="text-sm font-medium">Daily budget</label>
          <div className="relative mt-1"><Input id={budgetId} type="text" className="h-11 pr-11 text-base sm:text-sm" inputMode="decimal" maxLength={25} value={budget} onChange={(event) => { setBudget(event.target.value); setNotice(""); }} />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">THB</span></div>
        </div>
      </div>
      <label className="block text-sm font-medium">Campaign Name <Input className="mt-1 h-11 text-base sm:text-sm" maxLength={128} value={name} onChange={(event) => { setName(event.target.value); setNotice(""); }} /></label>
      <details className="rounded-md border px-2.5">
        <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">Schedule · เวลาไทย</summary>
        <div className="space-y-2 pb-2">
          <label className="block text-xs font-medium">Start date <Input type="datetime-local" value={start} onChange={(event) => { setStart(event.target.value); setNotice(""); }} className="mt-1 h-11 min-w-0 text-base sm:text-sm" /></label>
          <label className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={setEndDate} onChange={(event) => { setSetEndDate(event.target.checked); setNotice(""); }} className="size-4 accent-primary" />กำหนดวันสิ้นสุด</label>
          {setEndDate && <label className="block text-xs font-medium">End date <Input type="datetime-local" value={end} onChange={(event) => { setEnd(event.target.value); setNotice(""); }} className="mt-1 h-11 min-w-0 text-base sm:text-sm" /></label>}
          {invalidEnd && <p className="text-xs text-muted-foreground">เลือกวันเริ่มและวันสิ้นสุด โดยให้วันสิ้นสุดอยู่หลังวันเริ่ม</p>}
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={proposedRoi === null || proposedBudget === null || invalidEnd} onClick={() => void copyDraft()}>คัดลอกค่าที่กรอก</Button>
      </div>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    </CreatorCampaignFormSection>
  </>;
}

function Back({ onBack }: { onBack: () => void }) {
  return <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" onClick={onBack}><ArrowLeft className="size-4" aria-hidden />กลับไปรายการ</Button>;
}

export function CreatorAccountCampaigns({ client, userId, now, onSync, onRefreshCampaign }: DialogProps) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const date = bangkokDay(now);
  const report = useQuery({
    queryKey: ["automation", "campaigns-today", userId, client.clientId, client.advertiserId, client.tiktokAccountId, date],
    queryFn: ({ signal }) => fetchAutomationCampaignsToday(client.clientId, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false, gcTime: 120_000,
  });
  const denied = report.error instanceof ApiError && [401, 403, 404].includes(report.error.status ?? 0);
  const snapshot = campaignsTodayForClient(!denied ? report.data : undefined, client, Math.max(now, report.dataUpdatedAt));
  const coverage = snapshot ? report.isError ? "partial" : snapshot.coverage : "unavailable";
  const rows = snapshot?.campaigns ?? overviewFallback(client, now);
  const visible = visibleCampaignBreakdown(rows, now);
  const selected = screen?.type === "edit" ? rows.find((row) => row.campaignId === screen.id) : undefined;
  const enabled = rows.filter((row) => !endedTodayRow(row, now));
  const current = enabled.length === 1 ? enabled[0]! : null;
  const accountName = client.tiktokUsername ? `@${client.tiktokUsername}` : client.displayName;
  function open(next: Screen, source: HTMLElement) {
    trigger.current = source;
    setScreen(next);
  }
  const close = () => setScreen(null);
  function refresh() {
    onRefreshCampaign();
    void report.refetch();
  }

  return <section aria-label={`แคมเปญของ ${accountName}`} className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">แคมเปญวันนี้ <span className="font-normal text-muted-foreground">· {date}</span></h3>
        <p className="text-[11px] text-muted-foreground">{visible.length} รายการ · รวมรายการเปิดอยู่และรายการที่มี Cost</p>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" className="min-h-10 px-2.5" onClick={(event) => open({ type: "create" }, event.currentTarget)}><Plus className="size-4" aria-hidden /> สร้างแคมเปญ</Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" aria-label="อัปเดตรายการแคมเปญ"
          disabled={report.isFetching} onClick={refresh}><RefreshCw className={cn("size-4", report.isFetching && "animate-spin")} aria-hidden /></Button>
      </div>
    </div>
    {visible.length ? <CreatorCampaignBreakdownTable rows={rows} clientId={client.clientId} now={now}
      onEdit={(row, source) => open({ type: "edit", id: row.campaignId }, source)}
      onLifecycle={(row, action, source) => open({ type: "lifecycle", row, action }, source)} /> : <p className="rounded-md border bg-card p-2.5 text-xs text-muted-foreground">
      {report.isFetching ? "กำลังอ่านแคมเปญ…" : coverage === "complete" ? "ไม่พบแคมเปญเปิดอยู่หรือมี Cost วันนี้" : "ยังอ่านรายการแคมเปญของวันนี้ไม่ครบ"}
    </p>}
    <p className="text-[11px] text-muted-foreground">
      {coverage === "complete" ? "รายงานรายแคมเปญ · เวลาไทย · ตัวเลขอาจมาช้า" : "ข้อมูลรายแคมเปญอาจยังไม่ครบ"}
      {client.clientId !== PILOT_BUDGET_CLIENT_ID ? " · สถานะของบัญชีนี้อ่านได้อย่างเดียว" : enabled.length ? " · หากจะเปิดรายการเดิม ต้องปิดแคมเปญที่เปิดอยู่ก่อน" : ""}
      {visible.some((row) => row.viewerBoostBudgetMinor == null) && <> · Viewer Boost ที่เป็น — ยังไม่มีข้อมูลยืนยัน <a className="underline underline-offset-2" href={viewerBoostHelp} target="_blank" rel="noopener noreferrer">ดูวิธีตั้งใน TikTok</a></>}
    </p>
    {client.clientId === PILOT_BUDGET_CLIENT_ID && hasPendingCampaignOperation(userId) && <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={(event) => open({ type: "recovery" }, event.currentTarget)}>ตรวจผลคำสั่งที่ค้าง</Button>}
    {!enabled.length && <OptionalAccountAuto client={client} userId={userId} />}
    <Dialog open={screen !== null} onOpenChange={(active) => { if (!active) close(); }}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[calc(100dvh-1rem)] max-w-none translate-x-0 translate-y-0 flex-col rounded-b-none rounded-t-xl p-0 [&>button]:grid [&>button]:size-10 [&>button]:place-items-center sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        onCloseAutoFocus={(event) => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}>
        <div className="flex min-h-0 flex-col">
          <header className="shrink-0 border-b px-4 py-3 pr-16 sm:px-5 sm:pr-16">
            <DialogTitle className="break-words text-lg font-semibold tracking-tight">
              {screen?.type === "edit" ? "แก้ไขแคมเปญ" : screen?.type === "create" ? "สร้างแคมเปญ" : "จัดการแคมเปญ"} · {accountName}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">LIVE GMV Max · {date} เวลาไทย</DialogDescription>
          </header>
          <div className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain bg-muted/25 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4">
            {screen?.type === "create" && <CreateDraft current={current} onBack={close} />}
            {screen?.type === "recovery" && client.clientId === PILOT_BUDGET_CLIENT_ID && <>
              <Back onBack={close} />
              <CampaignControlPanel layout="recovery" userId={userId} onVerified={refresh} />
            </>}
            {screen?.type === "edit" && selected && <>
              <CreatorCampaignEditPanel key={selected.campaignId} client={client} campaign={selected} actualRoi={selected.roi} userId={userId}
                now={now} onBack={close} onSync={onSync} onRefreshCampaign={refresh} />
              <ViewerBoostInfo row={selected} />
            </>}
            {screen?.type === "lifecycle" && <>
              <Back onBack={close} />
              <CreatorCampaignFormSection title={screen.row.campaignName} tag="เปลี่ยนสถานะ">
                <CampaignControlPanel key={`${screen.row.campaignId}:${screen.action}`} layout="lifecycle" userId={userId} selectedCampaignId={screen.row.campaignId}
                  lifecycleAction={screen.action} onVerified={refresh} />
              </CreatorCampaignFormSection>
            </>}
            {screen?.type === "edit" && !selected && <>
              <Back onBack={close} />
              <p role="status" className="rounded-lg border bg-card p-3 text-sm">ยังยืนยันข้อมูลของแคมเปญที่เลือกไม่ได้ กรุณากลับไปดูรายการล่าสุด</p>
            </>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
