import { useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Activity, CirclePlay, RefreshCw, SlidersHorizontal, UserRound } from "lucide-react";
import { PILOT_BUDGET_CLIENT_ID, type AutomationCampaign, type AutomationClient, type AutomationOverview } from "@/api/automation";
import { isBudgetCapClientId, type BudgetCapClientId } from "@/api/automationBudget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BANGKOK, isFreshAutomationClient } from "@/lib/automation";
import { formatBudgetBaht } from "@/lib/automationBudget";
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
const tabClass = "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

function sameBinding(a: CreatorBinding, b: CreatorBinding) {
  return a.clientId === b.clientId && a.advertiserId === b.advertiserId && a.tiktokAccountId === b.tiktokAccountId;
}

/** Bind the explicit Sync to this identity, not simply to the currently selected tab or an earlier request. */
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

  return <section className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4" aria-label="ข้อมูลบัญชีและแคมเปญ">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">ข้อมูลบัญชีและแคมเปญ</h3>
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
      {campaign && <>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">แคมเปญที่เปิดอยู่</dt><dd className="break-words font-medium">{campaign.campaignName}</dd><dd className="break-all font-mono text-xs text-muted-foreground">{campaign.campaignId}</dd></div>
        <div><dt className="text-muted-foreground">งบปัจจุบัน</dt><dd className="tabular font-medium">{formatBudgetBaht(campaign.dailyBudgetMinor)}</dd></div>
        <div><dt className="text-muted-foreground">ROI Target</dt><dd className="tabular font-medium">{campaign.targetRoi === null ? "—" : `${formatValue(campaign.targetRoi, "ratio")}×`}</dd></div>
      </>}
    </dl>
    {campaign ? <CreatorEditBudgetMeter campaign={campaign} /> : <p className="text-sm text-muted-foreground">{fresh ? "ไม่พบแคมเปญที่เปิดในข้อมูลล่าสุด" : "ยังไม่มีสถานะแคมเปญล่าสุดที่ยืนยันได้"}</p>}
  </section>;
}

function CreatorAutoDiagnostics({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-md border border-border px-3 py-1">
    <summary className="min-h-10 cursor-pointer py-2.5 text-sm font-medium">ประวัติการทำงานและการแจ้ง LINE</summary>
    {open && <div className="pb-2"><AutoDiagnosticsPanel userId={userId} /></div>}
  </details>;
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

    <Tabs.Root defaultValue="account" activationMode="manual" className="flex min-h-0 flex-col">
      <Tabs.List aria-label="จัดการ Creator" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2 sm:px-5">
        <Tabs.Trigger value="account" className={tabClass}><UserRound className="h-4 w-4" aria-hidden />บัญชี</Tabs.Trigger>
        <Tabs.Trigger value="budget" className={tabClass}><SlidersHorizontal className="h-4 w-4" aria-hidden />งบ / เพดาน</Tabs.Trigger>
        <Tabs.Trigger value="auto" className={tabClass}><Activity className="h-4 w-4" aria-hidden />Auto</Tabs.Trigger>
        <Tabs.Trigger value="campaign" className={tabClass}><CirclePlay className="h-4 w-4" aria-hidden />แคมเปญ</Tabs.Trigger>
      </Tabs.List>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
        <Tabs.Content value="account"><AccountInfo client={client} now={currentTime} /></Tabs.Content>
        <Tabs.Content value="budget" className="space-y-2">
          {scope.budgetClientId ? <>
            {!scope.syncCurrent && <p className="text-sm text-muted-foreground">Sync ก่อนปรับงบหรือเพดาน · ยังตรวจผลรายการเดิมได้</p>}
            <ManualBudgetPanel userId={userId} clientId={scope.budgetClientId} active={scope.syncCurrent} clients={[client]} onRefreshCampaign={onRefreshCampaign} />
          </> : <p className="text-sm text-muted-foreground">บัญชีนี้ยังไม่เปิดสิทธิ์ปรับงบหรือเพดานจากเว็บ</p>}
        </Tabs.Content>
        <Tabs.Content value="auto" className="space-y-2">
          {scope.autoClientId ? <>
            {!scope.autoCampaignId && <p className="text-sm text-muted-foreground">การเปิด Auto ต้อง Sync และพบแคมเปญที่เปิดอยู่ · หากมี Auto ทำงานอยู่ ยังหยุดได้โดยไม่ต้อง Sync</p>}
            <AutoBudgetStatusPanel userId={userId} clientId={scope.autoClientId} campaignId={scope.autoCampaignId} />
            {scope.autoClientId === PILOT_BUDGET_CLIENT_ID && <CreatorAutoDiagnostics userId={userId} />}
          </> : <p className="text-sm text-muted-foreground">บัญชีนี้ยังไม่รองรับ Auto Budget จากเว็บ</p>}
        </Tabs.Content>
        <Tabs.Content value="campaign" className="space-y-2">
          <p className="text-sm text-muted-foreground">ยังสร้างแคมเปญ Creator ใหม่จากหน้านี้ไม่ได้</p>
          {scope.campaignControl ? <CampaignControlPanel userId={userId} actionsEnabled={scope.syncCurrent}
            syncedCampaignId={sync?.campaignId} onVerified={onRefreshCampaign} />
            : <p className="text-sm text-muted-foreground">บัญชีนี้ยังไม่รองรับคำสั่งพัก เปิดแคมเปญเดิม หรือปรับ ROI Target จาก Automation</p>}
        </Tabs.Content>
      </div>
    </Tabs.Root>
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
