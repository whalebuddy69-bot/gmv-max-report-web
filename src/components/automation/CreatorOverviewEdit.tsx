import { useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw, UserRound } from "lucide-react";
import { PILOT_BUDGET_CLIENT_ID, type AutomationCampaign, type AutomationClient, type AutomationOverview } from "@/api/automation";
import { isBudgetCapClientId, type BudgetCapClientId } from "@/api/automationBudget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BANGKOK, isFreshAutomationClient } from "@/lib/automation";
import { formatValue } from "@/lib/format";
import { AutoBudgetStatusPanel } from "./AutoBudgetStatusPanel";
import { AutoDiagnosticsPanel } from "./AutoDiagnosticsPanel";
import { CampaignControlPanel } from "./CampaignControlPanel";
import { ManualBudgetPanel } from "./ManualBudgetPanel";

type EditProps = {
  client: AutomationClient | null;
  userId: number;
  now: number;
  onClose: () => void;
  onRefreshCampaign: () => void;
  onSync: () => Promise<AutomationOverview | null>;
};

type CreatorBinding = Pick<AutomationClient, "clientId" | "advertiserId" | "tiktokAccountId">;
type CreatorEditSync = CreatorBinding & Pick<AutomationClient, "reportingDate" | "observedAt"> & {
  campaignId: string | null;
};

const readTime = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const percentFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const formSection = "min-w-0 space-y-3 rounded-lg border border-border bg-card p-3.5 sm:p-4";
const scheduleTime = new Intl.DateTimeFormat("en-GB", { timeZone: BANGKOK, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function sameBinding(a: CreatorBinding, b: CreatorBinding) {
  return a.clientId === b.clientId && a.advertiserId === b.advertiserId && a.tiktokAccountId === b.tiktokAccountId;
}

/** Bind the explicit Sync to this identity, not simply to an earlier request. */
export function getCreatorEditSync(overview: AutomationOverview | null, selected: AutomationClient, now: number): CreatorEditSync | null {
  const current = overview?.clients.find((candidate) => sameBinding(candidate, selected));
  if (!current || !isFreshAutomationClient(current, now)) return null;
  return {
    clientId: current.clientId,
    advertiserId: current.advertiserId,
    tiktokAccountId: current.tiktokAccountId,
    reportingDate: current.reportingDate,
    observedAt: current.observedAt,
    campaignId: current.campaign?.campaignId ?? null,
  };
}

export function isCreatorEditSyncCurrent(sync: CreatorEditSync | null, client: AutomationClient, now: number) {
  return !!sync && sameBinding(sync, client) && sync.reportingDate === client.reportingDate
    && sync.campaignId === (client.campaign?.campaignId ?? null)
    && isFreshAutomationClient(client, now) && isFreshAutomationClient({ ...client, observedAt: sync.observedAt }, now);
}

export function creatorEditControlScope(client: AutomationClient, sync: CreatorEditSync | null, now: number) {
  const syncCurrent = isCreatorEditSyncCurrent(sync, client, now);
  const autoClientId: BudgetCapClientId | null = isBudgetCapClientId(client.clientId) ? client.clientId : null;
  return {
    syncCurrent,
    budgetClientId: autoClientId === PILOT_BUDGET_CLIENT_ID && client.budgetControlAvailable === false ? null : autoClientId,
    // The scoped read/Stop path never requires a current campaign or Sync. Arming still does.
    autoClientId,
    autoCampaignId: syncCurrent ? client.campaign?.campaignId ?? null : null,
    campaignControl: client.clientId === PILOT_BUDGET_CLIENT_ID,
  };
}

export function CreatorEditBudgetMeter({ campaign }: { campaign: AutomationCampaign }) {
  if (campaign.spendMinor === null) return <p className="text-xs text-muted-foreground">ยังยืนยันยอดใช้ของแคมเปญไม่ได้</p>;
  const percent = (campaign.spendMinor / campaign.dailyBudgetMinor) * 100;
  const label = `${percentFormatter.format(percent)}% ของงบแคมเปญ`;
  return <div className="space-y-1.5 rounded-md border border-border p-2.5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
      <span className="font-medium">ใช้งบวันนี้</span><span className="tabular text-muted-foreground">{label}</span>
    </div>
    <div role="meter" aria-label="สัดส่วนงบที่ใช้วันนี้" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.min(100, percent)} aria-valuetext={`${label} · เกณฑ์ Auto 80%`} className="relative h-2 rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
      <span aria-hidden className="absolute -top-0.5 h-3 w-0.5 bg-foreground" style={{ left: "80%" }} />
    </div>
    <p className="text-xs text-muted-foreground">เส้น 80% คือเกณฑ์ยอดใช้ ไม่ได้ยืนยันว่า Auto เพิ่มงบแล้ว</p>
  </div>;
}

function AccountInfo({ client, now }: { client: AutomationClient; now: number }) {
  const fresh = isFreshAutomationClient(client, now);
  const campaign = fresh ? client.campaign : null;
  const status = client.access === "verified" ? fresh ? "อ่านข้อมูลได้" : "ข้อมูลเก่า"
    : client.accessReason === "needs-authorization" ? "รออนุญาตบัญชี"
      : client.accessReason === "identity-unverified" ? "รอยืนยันตัวตน Creator"
        : client.accessReason === "upstream-unavailable" ? "ข้อมูลจาก TikTok ยังไม่พร้อม" : "ยังยืนยันการเข้าถึงไม่ได้";

  return <section className={formSection} aria-label="ข้อมูลบัญชี">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold"><UserRound className="size-4 text-muted-foreground" aria-hidden />ข้อมูลบัญชี</h3>
      <Badge variant={fresh ? "success" : client.access === "verified" ? "warning" : "outline"}>{status}</Badge>
    </div>
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Ad Account ID</dt><dd className="break-all font-mono text-xs">{client.advertiserId}</dd></div>
      <div>
        <dt className="text-muted-foreground">TikTok Account ID</dt>
        <dd className="break-all font-mono text-xs">{client.tiktokAccountId}</dd>
        {client.tiktokAccountIdVerified === false && <dd className="text-xs text-muted-foreground">ตามที่แจ้ง · API ยังไม่ได้ยืนยันเลขนี้โดยตรง</dd>}
      </div>
      <div><dt className="text-muted-foreground">อ่านล่าสุด · เวลาไทย</dt><dd>{client.observedAt ? `${readTime.format(new Date(client.observedAt))} น.` : "—"}</dd></div>
      <div><dt className="text-muted-foreground">วันที่รายงาน</dt><dd>{client.reportingDate ?? "—"}</dd></div>
      {campaign && <div className="sm:col-span-2"><dt className="text-muted-foreground">Campaign ID</dt><dd className="break-all font-mono text-xs">{campaign.campaignId}</dd></div>}
    </dl>
    {!campaign && <p className="text-sm text-muted-foreground">{fresh ? "ไม่พบแคมเปญที่เปิดในข้อมูลล่าสุด" : "ยังไม่มีสถานะแคมเปญล่าสุดที่ยืนยันได้"}</p>}
  </section>;
}

function ReadOnlyField({ label, value, unit }: { label: string; value: string | null; unit?: string }) {
  return <label className="block min-w-0 text-sm font-medium">
    <span>{label}</span>
    <span className="relative mt-1.5 block">
      <Input readOnly value={value ?? ""} placeholder="—" className={unit ? "h-11 bg-muted/45 pr-14 text-base sm:text-sm" : "h-11 bg-muted/45 text-base sm:text-sm"} />
      {unit && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>}
    </span>
  </label>;
}

function formatSchedule(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(scheduleTime.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function CreatorCampaignSchedule({ campaign }: { campaign: AutomationCampaign | null }) {
  const start = formatSchedule(campaign?.scheduleStartAt);
  const end = start ? formatSchedule(campaign?.scheduleEndAt) : null;
  const continuous = start !== null && campaign?.scheduleEndAt === null;
  return <section className={formSection} aria-label="Schedule">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="size-4 text-muted-foreground" aria-hidden />Schedule</h3>
      <Badge variant="outline">เวลาไทย (UTC+7) · อ่านอย่างเดียว</Badge>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <ReadOnlyField label="Start date" value={start} />
      <ReadOnlyField label="End date" value={end ?? (continuous ? "ไม่กำหนดวันสิ้นสุด" : null)} />
    </div>
    {end || continuous ? <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" role="switch" checked={end !== null} disabled aria-label="กำหนดวันสิ้นสุด" className="size-4 accent-primary" />
      {end ? "กำหนดวันสิ้นสุด" : "รันต่อเนื่องโดยไม่กำหนดวันสิ้นสุด"}
    </label> : <p className="text-sm text-muted-foreground">ยังยืนยันการตั้งวันสิ้นสุดไม่ได้</p>}
    <ReadOnlyField label="Campaign Name" value={campaign?.campaignName ?? null} />
    <p className="text-xs text-muted-foreground">ยังแก้ชื่อหรือกำหนดเวลาจากหน้านี้ไม่ได้ หากต้องการเปลี่ยน ให้ตรวจตัวเลือกของแคมเปญใน TikTok Ads Manager</p>
  </section>;
}

function CreatorAutoDiagnostics({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-md border border-border px-3 py-1">
    <summary className="min-h-10 cursor-pointer py-2.5 text-sm font-medium">ประวัติการทำงานและการแจ้ง LINE</summary>
    {open && <div className="pb-2"><AutoDiagnosticsPanel userId={userId} /></div>}
  </details>;
}

export function CreatorEditFormFields({ client, userId, now, sync, onRefreshCampaign }: {
  client: AutomationClient;
  userId: number;
  now: number;
  sync: CreatorEditSync | null;
  onRefreshCampaign: () => void;
}) {
  const scope = creatorEditControlScope(client, sync, now);
  const campaign = isFreshAutomationClient(client, now) ? client.campaign : null;
  const autoClientId = scope.autoClientId;
  function renderAuto(blockAutoStart: boolean) {
    return autoClientId ? <AutoBudgetStatusPanel variant="campaign-form" blockAutoStart={blockAutoStart}
      userId={userId} clientId={autoClientId} campaignId={scope.autoCampaignId} /> : <section className={formSection} aria-label="Auto budget increase">
      <h3 className="text-base font-semibold">Auto budget increase</h3>
      <p className="text-sm text-muted-foreground">บัญชีนี้ยังไม่รองรับ Auto Budget จากเว็บ</p>
    </section>;
  }
  return <>
    <AccountInfo client={client} now={now} />
    {scope.campaignControl ? <CampaignControlPanel layout="roi-field" fallbackRoi={campaign?.targetRoi ?? null} userId={userId}
      actionsEnabled={scope.syncCurrent} syncedCampaignId={sync?.campaignId} onVerified={onRefreshCampaign} /> : <section className={formSection} aria-label="LIVE ROI Target">
      <ReadOnlyField label="LIVE ROI Target" unit="×" value={campaign?.targetRoi == null ? null : formatValue(campaign.targetRoi, "ratio")} />
      <p className="text-xs text-muted-foreground">เป้าหมาย ROI เป็นจำนวนเท่า · บัญชีนี้ยังแก้จากเว็บไม่ได้</p>
    </section>}
    {scope.budgetClientId ? <ManualBudgetPanel variant="campaign-form" renderBetweenBudgetAndCeiling={renderAuto}
      userId={userId} clientId={scope.budgetClientId} active={scope.syncCurrent} clients={[client]} onRefreshCampaign={onRefreshCampaign} /> : <>
      <section className={formSection} aria-label="Daily budget">
        <ReadOnlyField label="Daily budget" unit="THB" value={campaign ? formatValue(campaign.dailyBudgetMinor / 100, "decimal") : null} />
        <p className="text-xs text-muted-foreground">บัญชีนี้ยังไม่เปิดสิทธิ์ปรับงบจากเว็บ</p>
      </section>
      {renderAuto(false)}
      <section className={formSection} aria-label="Daily Ceiling">
        <ReadOnlyField label="Daily Ceiling" unit="THB" value={null} />
        <p className="text-xs text-muted-foreground">บัญชีนี้ยังไม่เปิดสิทธิ์ตั้งเพดานจากเว็บ</p>
      </section>
    </>}
    <CreatorCampaignSchedule campaign={campaign} />
    {campaign && <details className="rounded-md border border-border bg-card px-3 py-1">
      <summary className="min-h-10 cursor-pointer py-2.5 text-sm font-medium">ดูสัดส่วนงบที่ใช้วันนี้</summary>
      <div className="pb-2"><CreatorEditBudgetMeter campaign={campaign} /></div>
    </details>}
    {autoClientId === PILOT_BUDGET_CLIENT_ID && <CreatorAutoDiagnostics userId={userId} />}
  </>;
}

function EditBody({ client, userId, now, onRefreshCampaign, onSync }: Omit<EditProps, "onClose" | "client"> & { client: AutomationClient }) {
  const [sync, setSync] = useState<CreatorEditSync | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const syncLock = useRef(false);
  const currentTime = Math.max(now, clock ?? now);
  const scope = creatorEditControlScope(client, sync, currentTime);

  useEffect(() => {
    if (!sync) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [sync]);

  async function syncSelected() {
    if (syncLock.current) return;
    syncLock.current = true;
    setSync(null);
    setSyncFailed(false);
    setSyncing(true);
    try {
      const latest = getCreatorEditSync(await onSync(), client, Date.now());
      setSync(latest);
      setSyncFailed(latest === null);
    } catch {
      setSyncFailed(true);
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }

  return <div className="flex min-h-0 flex-col">
    <header className="space-y-3 border-b border-border p-4 sm:p-5">
      <div className="min-w-0 pr-12">
        <DialogTitle className="break-words text-xl font-semibold tracking-tight">จัดการ {client.displayName}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">ตั้งค่า LIVE GMV Max ของบัญชีนี้ · LINE ใช้แจ้งผล</DialogDescription>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={syncing} onClick={() => void syncSelected()}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden /> {syncing ? "กำลัง Sync…" : "Sync บัญชีนี้"}
        </Button>
        <p role="status" className="min-w-0 flex-1 basis-40 break-words text-xs text-muted-foreground">
          {scope.syncCurrent ? "Sync สำเร็จ · ไม่ได้แก้ไขแคมเปญ" : syncing ? "กำลังอ่านข้อมูลล่าสุดจาก TikTok…" : syncFailed ? "ยังยืนยันข้อมูลบัญชีนี้ไม่ได้ กรุณาลองอีกครั้ง" : sync ? "ข้อมูลหมดอายุหรือแคมเปญเปลี่ยน กรุณา Sync ใหม่" : "Sync เพื่ออ่านข้อมูลก่อนสั่งงาน · ไม่เปิดแอดหรือเปลี่ยนงบ"}
        </p>
      </div>
    </header>

    <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain bg-muted/30 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
      <CreatorEditFormFields client={client} userId={userId} now={currentTime} sync={sync} onRefreshCampaign={onRefreshCampaign} />
    </div>
  </div>;
}

export function CreatorOverviewEdit({ client, userId, onClose, ...props }: EditProps) {
  const openingControl = useRef<HTMLElement | null>(null);
  return <Dialog open={client !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[calc(100dvh-1rem)] max-w-none translate-x-0 translate-y-0 flex-col rounded-b-none rounded-t-xl p-0 [&>button]:grid [&>button]:size-11 [&>button]:place-items-center sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
      onOpenAutoFocus={() => { openingControl.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => {
        if (!openingControl.current?.isConnected) return;
        event.preventDefault();
        openingControl.current.focus({ preventScroll: true });
      }}>
      {client && <EditBody key={JSON.stringify([userId, client.clientId, client.advertiserId, client.tiktokAccountId])} client={client} userId={userId} {...props} />}
    </DialogContent>
  </Dialog>;
}
