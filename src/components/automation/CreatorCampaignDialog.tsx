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
  client: AutomationClient | null;
  userId: number;
  now: number;
  onClose: () => void;
  onRefreshCampaign: () => void;
  onSync: () => Promise<AutomationOverview | null>;
};
type Row = Omit<AutomationCampaignToday, "scheduleStartAt" | "scheduleEndAt"> & { scheduleStartAt?: string | null; scheduleEndAt?: string | null };
type Screen = { type: "list" } | { type: "edit"; id: string } | { type: "create" } | { type: "recovery" } | { type: "lifecycle"; row: Row; action: "PAUSE" | "RESUME" };
const listScreen = { type: "list" } as const;
const numericCampaign = /^[1-9]\d{5,30}$/;
const adsManager = "https://ads.tiktok.com/i18n/";

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

function CampaignRow({ row, clientId, hasEnabled, now, onEdit, onLifecycle }: {
  row: Row; clientId: string; hasEnabled: boolean; now: number;
  onEdit: (id: string) => void; onLifecycle: (id: string, action: "PAUSE" | "RESUME") => void;
}) {
  const enabled = row.operationStatus === "ENABLE";
  const ended = endedTodayRow(row, now);
  const action = allowedLifecycleIntent(row, clientId, hasEnabled, now);
  return <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="min-w-0 break-words text-sm font-semibold">{row.campaignName}</span>
        <Badge variant={enabled && !ended ? "success" : "outline"} className="px-1.5 py-0 text-[10px]">{row.operationStatus === "DELETE" ? "ลบแล้ว" : enabled && ended ? "หมดเวลา" : enabled ? "เปิด" : "ปิด"}</Badge>
      </div>
      <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{row.campaignId}</p>
      {row.roi !== null && <p className="mt-0.5 text-xs text-muted-foreground">ROI วันนี้ <span className="font-medium text-foreground">{formatValue(row.roi, "ratio")}×</span></p>}
    </div>
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      <button type="button" role="switch" aria-label={`${enabled ? "ปิด" : "เปิดอีกครั้ง"} ${row.campaignName}`} aria-checked={enabled} disabled={!action}
        title={!action ? "ยังสลับสถานะรายการนี้จากเว็บไม่ได้" : "เปิดหน้าตรวจและยืนยัน"}
        onClick={() => { if (action) onLifecycle(row.campaignId, action); }}
        className="flex h-11 items-center rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45">
        <span aria-hidden className={cn("relative block h-5 w-9 rounded-full", enabled ? "bg-primary" : "bg-muted-foreground/45")}>
          <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm", enabled && "translate-x-4")} />
        </span>
      </button>
      <Button type="button" size="sm" variant="ghost" className="min-h-11 px-2" aria-label={`แก้ไข ${row.campaignName}`} onClick={() => onEdit(row.campaignId)}>
        <Pencil className="size-3.5" aria-hidden /><span className="hidden sm:inline">แก้ไข</span>
      </Button>
    </div>
  </li>;
}

function OptionalAccountAuto({ client, userId }: { client: AutomationClient; userId: number }) {
  const [open, setOpen] = useState(false);
  if (!isBudgetCapClientId(client.clientId)) return null;
  return <details className="rounded-lg border bg-card px-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="min-h-10 cursor-pointer py-2.5 text-xs font-medium">จัดการ Auto Budget ของบัญชี</summary>
    {open && <div className="pb-2"><AutoBudgetStatusPanel clientId={client.clientId} userId={userId} campaignId={null} variant="campaign-form" /></div>}
  </details>;
}

function CampaignList({ client, rows, loading, coverage, now, userId, onEdit, onCreate, onLifecycle, onReload, onRecover }: {
  client: AutomationClient; rows: Row[]; loading: boolean; coverage: AutomationCampaignsToday["coverage"]; now: number; userId: number;
  onEdit: (id: string) => void; onCreate: () => void; onLifecycle: (id: string, action: "PAUSE" | "RESUME") => void; onReload: () => void; onRecover: () => void;
}) {
  const [allClosed, setAllClosed] = useState(false);
  const enabled = rows.filter((row) => !endedTodayRow(row, now));
  const closed = rows.filter((row) => endedTodayRow(row, now) && row.activityToday);
  const hasEnabled = rows.some((row) => row.operationStatus === "ENABLE");
  const renderRow = (row: Row) => <CampaignRow key={row.campaignId} row={row} clientId={client.clientId} hasEnabled={hasEnabled} now={now} onEdit={onEdit} onLifecycle={onLifecycle} />;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">TikTok Account ID</p>
        <p className="break-all font-mono text-xs font-medium">{client.tiktokAccountId}</p>
      </div>
      <Button type="button" size="sm" className="min-h-11" onClick={onCreate}><Plus className="size-4" aria-hidden />สร้างแคมเปญ</Button>
    </div>
    <section aria-label="แคมเปญที่เปิดอยู่" className="overflow-hidden rounded-lg border bg-card">
      <div className="flex min-h-10 items-center justify-between border-b px-3">
        <h3 className="text-sm font-semibold">แคมเปญที่เปิดอยู่</h3><Badge variant="secondary">{enabled.length} รายการ</Badge>
      </div>
      {enabled.length ? <ul className="divide-y">{enabled.map(renderRow)}</ul> : <p className="px-3 py-2.5 text-xs text-muted-foreground">{loading ? "กำลังอ่านข้อมูล…" : "ไม่พบแคมเปญที่เปิดในข้อมูลที่อ่านได้"}</p>}
    </section>
    <section aria-label="แคมเปญปิดแล้วที่มีผลวันนี้" className="overflow-hidden rounded-lg border bg-card">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-1 border-b px-3">
        <h3 className="text-sm font-semibold">ปิดหรือจบแล้ว · มีผลวันนี้</h3><Badge variant="secondary">{closed.length} รายการที่พบ</Badge>
      </div>
      {closed.length ? <ul className="divide-y">{(allClosed ? closed : closed.slice(0, 4)).map(renderRow)}</ul> : <p className="px-3 py-2.5 text-xs text-muted-foreground">
        {loading ? "กำลังอ่านแคมเปญของวันนี้…" : coverage === "complete" ? "ยังไม่พบแคมเปญที่ปิดแล้วและมีผลในรายงานวันนี้" : "ยังยืนยันรายการที่ปิดแล้วของวันนี้ไม่ได้"}
      </p>}
      {closed.length > 4 && <Button type="button" variant="ghost" size="sm" className="min-h-10 rounded-none border-t px-3" aria-expanded={allClosed} onClick={() => setAllClosed(!allClosed)}>{allClosed ? "แสดงน้อยลง" : `ดูทั้งหมด ${closed.length} รายการ`}</Button>}
    </section>
    <div className="flex min-w-0 items-start justify-between gap-2">
      <p className="pt-2 text-xs text-muted-foreground">{coverage === "complete" ? "ตามรายงานวันนี้ · เวลาไทย · ตัวเลขอาจมาช้า" : loading ? "กำลังอัปเดตรายงานวันนี้" : "ข้อมูลวันนี้อาจยังไม่ครบ · รายการไม่พบไม่ได้แปลว่าไม่มีการยิงแอด"}
        {client.clientId === PILOT_BUDGET_CLIENT_ID && hasEnabled && closed.some((row) => row.operationStatus === "DISABLE") && <span className="mt-1 block">หากจะเปิดรายการเดิม ให้ปิดแคมเปญที่เปิดอยู่ก่อน</span>}
        {client.clientId !== PILOT_BUDGET_CLIENT_ID && <span className="mt-1 block">สถานะแคมเปญของบัญชีนี้ยังอ่านได้อย่างเดียว</span>}
      </p>
      <Button type="button" variant="ghost" size="sm" className="min-h-10 shrink-0 px-2" aria-label="อัปเดตรายการแคมเปญ" disabled={loading} onClick={onReload}>
        <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden /> <span className="hidden sm:inline">อัปเดต</span>
      </Button>
    </div>
    {client.clientId === PILOT_BUDGET_CLIENT_ID && hasPendingCampaignOperation(userId) && <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={onRecover}>ตรวจผลคำสั่งที่ค้าง</Button>}
    {!enabled.length && <OptionalAccountAuto client={client} userId={userId} />}
  </>;
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
      <p className="text-xs text-muted-foreground">หน้านี้เตรียมค่าเท่านั้น ยังส่งสร้าง Creator LIVE GMV Max ไป TikTok โดยตรงไม่ได้</p>
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
        <Button asChild className="min-h-11"><a href={adsManager} target="_blank" rel="noopener noreferrer">เปิด TikTok Ads Manager <ExternalLink className="size-3.5" aria-hidden /></a></Button>
      </div>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    </CreatorCampaignFormSection>
  </>;
}

function Back({ onBack }: { onBack: () => void }) {
  return <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" onClick={onBack}><ArrowLeft className="size-4" aria-hidden />กลับไปรายการ</Button>;
}

function DialogBody({ client, userId, now, onSync, onRefreshCampaign }: Omit<DialogProps, "client" | "onClose"> & { client: AutomationClient }) {
  const [screen, setScreen] = useState<Screen>(listScreen);
  const viewport = useRef<HTMLDivElement | null>(null);
  const date = bangkokDay(now);
  const report = useQuery({
    queryKey: ["automation", "campaigns-today", userId, client.clientId, client.advertiserId, client.tiktokAccountId, date],
    queryFn: ({ signal }) => fetchAutomationCampaignsToday(client.clientId, signal),
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false, gcTime: 120_000,
  });
  const denied = report.error instanceof ApiError && [401, 403, 404].includes(report.error.status ?? 0);
  const snapshot = campaignsTodayForClient(!denied ? report.data : undefined, client, Math.max(now, report.dataUpdatedAt));
  const rows = snapshot?.campaigns ?? overviewFallback(client, now);
  const selected = screen.type === "edit" ? rows.find((row) => row.campaignId === screen.id) : undefined;
  const enabled = rows.filter((row) => !endedTodayRow(row, now));
  const current = enabled.length === 1 ? enabled[0]! : null;
  function move(next: Screen) {
    setScreen(next);
    if (viewport.current) viewport.current.scrollTop = 0;
  }
  function refresh() {
    onRefreshCampaign();
    void report.refetch();
  }

  return <div className="flex min-h-0 flex-col">
    <header className="shrink-0 border-b px-4 py-3 pr-16 sm:px-5 sm:pr-16">
      <DialogTitle className="break-words text-lg font-semibold tracking-tight">แคมเปญ · {client.displayName}</DialogTitle>
      <DialogDescription className="text-xs text-muted-foreground">LIVE GMV Max · {date} เวลาไทย</DialogDescription>
    </header>
    <div ref={viewport} className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain bg-muted/25 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4">
      {screen.type === "list" && <CampaignList client={client} rows={rows} coverage={snapshot ? report.isError ? "partial" : snapshot.coverage : "unavailable"} loading={report.isFetching}
        userId={userId} now={now} onCreate={() => move({ type: "create" })} onEdit={(id) => move({ type: "edit", id })}
        onLifecycle={(id, action) => { const row = rows.find((entry) => entry.campaignId === id); if (row) move({ type: "lifecycle", row, action }); }} onReload={refresh} onRecover={() => move({ type: "recovery" })} />}
      {screen.type === "create" && <CreateDraft current={current} onBack={() => move(listScreen)} />}
      {screen.type === "recovery" && client.clientId === PILOT_BUDGET_CLIENT_ID && <>
        <Back onBack={() => move(listScreen)} />
        <CampaignControlPanel layout="recovery" userId={userId} onVerified={refresh} />
      </>}
      {screen.type === "edit" && selected && <CreatorCampaignEditPanel key={selected.campaignId} client={client} campaign={selected} actualRoi={selected.roi} userId={userId}
        now={now} onBack={() => move(listScreen)} onSync={onSync} onRefreshCampaign={refresh} />}
      {screen.type === "lifecycle" && <>
        <Back onBack={() => move(listScreen)} />
        <CreatorCampaignFormSection title={screen.row.campaignName} tag="เปลี่ยนสถานะ">
          <CampaignControlPanel key={`${screen.row.campaignId}:${screen.action}`} layout="lifecycle" userId={userId} selectedCampaignId={screen.row.campaignId}
            lifecycleAction={screen.action} onVerified={refresh} />
        </CreatorCampaignFormSection>
      </>}
      {screen.type === "edit" && !selected && <>
        <Back onBack={() => move(listScreen)} />
        <p role="status" className="rounded-lg border bg-card p-3 text-sm">ยังยืนยันข้อมูลของแคมเปญที่เลือกไม่ได้ กรุณากลับไปดูรายการล่าสุด</p>
      </>}
    </div>
  </div>;
}

export function CreatorCampaignDialog({ client, userId, onClose, ...props }: DialogProps) {
  const trigger = useRef<HTMLElement | null>(null);
  return <Dialog open={client !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[calc(100dvh-1rem)] max-w-none translate-x-0 translate-y-0 flex-col rounded-b-none rounded-t-xl p-0 [&>button]:grid [&>button]:size-10 [&>button]:place-items-center sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
      onOpenAutoFocus={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}>
      {client && <DialogBody key={JSON.stringify([userId, client.clientId, client.advertiserId, client.tiktokAccountId])} client={client} userId={userId} {...props} />}
    </DialogContent>
  </Dialog>;
}
