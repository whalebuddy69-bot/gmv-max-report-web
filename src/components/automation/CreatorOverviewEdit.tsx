import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { isMonitoringOnlyCreator, PILOT_BUDGET_CLIENT_ID, type AutomationCampaign, type AutomationClient, type AutomationOverview } from "@/api/automation";
import { isBudgetCapClientId, type BudgetCapClientId } from "@/api/automationBudget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANGKOK, bangkokDay, isFreshAutomationClient } from "@/lib/automation";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AutoBudgetStatusPanel } from "./AutoBudgetStatusPanel";
import { AutoDiagnosticsPanel } from "./AutoDiagnosticsPanel";
import { CampaignControlPanel } from "./CampaignControlPanel";
import { ManualBudgetPanel } from "./ManualBudgetPanel";

export type CreatorEditCampaign = {
  campaignId: string;
  campaignName: string;
  operationStatus: "ENABLE" | "DISABLE" | "DELETE";
  targetRoi?: number | null;
  dailyBudgetMinor?: number | null;
  scheduleStartAt?: string | null;
  scheduleEndAt?: string | null;
};

type CreatorBinding = Pick<AutomationClient, "clientId" | "advertiserId" | "tiktokAccountId">;
type CreatorEditSync = CreatorBinding & Pick<AutomationClient, "reportingDate" | "observedAt"> & {
  campaignId: string | null;
};

const percentFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const formSection = "min-w-0 space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4";
// Budget controls supply adjacent sections (budget, Auto, ceiling). Keep the
// two primary fields equal while letting account-level controls span both columns.
const settingsGrid = "grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 sm:[&>*:nth-child(n+3)]:col-span-2 " +
  "[&>section:nth-child(-n+2)]:space-y-2 [&>section:nth-child(-n+2)]:p-3 sm:[&>section:nth-child(-n+2)]:p-3 " +
  "[&>section:nth-child(-n+2)>div:first-child]:min-h-6 sm:[&>section:nth-child(-n+2)>div:first-child]:min-h-9 " +
  "[&>section:nth-child(-n+2)_form>div:first-of-type]:max-w-none [&>section:nth-child(-n+2)_form>div:first-of-type]:basis-full " +
  "[&>section:nth-child(-n+2)>div:has(>input)]:max-w-none";
const scheduleTime = new Intl.DateTimeFormat("en-GB", { timeZone: BANGKOK, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function sameBinding(a: CreatorBinding, b: CreatorBinding) {
  return a.clientId === b.clientId && a.advertiserId === b.advertiserId && a.tiktokAccountId === b.tiktokAccountId;
}

/** Bind the fresh read to this identity, not simply to an earlier request. */
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

/** The list selects a specific row. Never substitute a different active campaign when opening it. */
export function findEditableCreatorCampaign(client: AutomationClient, selected: CreatorEditCampaign, now: number) {
  return selected.operationStatus === "ENABLE" && notPastScheduleEnd(selected.scheduleEndAt, now) && isFreshAutomationClient(client, now)
    && client.campaign?.campaignId === selected.campaignId && notPastScheduleEnd(client.campaign.scheduleEndAt, now)
    ? client.campaign : null;
}

function notPastScheduleEnd(value: string | null | undefined, now: number) {
  return value == null || Date.parse(value) > now;
}

export function resolveCreatorEditSnapshot(overview: AutomationOverview | null, client: AutomationClient, selection: CreatorEditCampaign, now: number) {
  const match = overview?.clients.find((entry) => sameBinding(entry, client));
  if (!match || !findEditableCreatorCampaign(match, selection, now)) return null;
  const proof = getCreatorEditSync(overview, client, now);
  return proof?.campaignId === selection.campaignId ? { client: match, proof } : null;
}

export function CreatorCampaignFormSection({ title, tag, className, children }: { title: string; tag?: string; className?: string; children: ReactNode }) {
  const heading = useId();
  return <section aria-labelledby={heading} className={cn(formSection, className)}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 id={heading} className="text-sm font-semibold sm:text-base">{title}</h3>
      {tag && <Badge variant="outline" className="font-normal">{tag}</Badge>}
    </div>
    {children}
  </section>;
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

type ReadOnlyValue = { value: string | null; unit?: string };

function ReadOnlyInput({ id, value, unit }: ReadOnlyValue & { id: string }) {
  return <div className="relative min-w-0">
    <Input id={id} readOnly value={value ?? ""} placeholder="—" className={cn("h-11 bg-muted/30 text-base tabular-nums sm:text-sm", unit && "pr-14")} />
    {unit && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>}
  </div>;
}

function ReadOnlyField({ label, ...field }: ReadOnlyValue & { label: string }) {
  const id = useId();
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <ReadOnlyInput id={id} {...field} />
  </div>;
}

function ReadOnlySetting({ label, children, ...field }: ReadOnlyValue & { label: string; children?: ReactNode }) {
  const id = useId();
  return <section className={formSection} aria-label={label}>
    <div className="flex items-center"><h3 className="text-base font-semibold"><label htmlFor={id}>{label}</label></h3></div>
    <ReadOnlyInput id={id} {...field} />
    {children}
  </section>;
}

function formatSchedule(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(scheduleTime.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function CreatorCampaignSchedule({ campaign, embedded = false }: {
  campaign: Pick<CreatorEditCampaign, "scheduleStartAt" | "scheduleEndAt" | "campaignName"> | null;
  embedded?: boolean;
}) {
  const start = formatSchedule(campaign?.scheduleStartAt);
  const end = start ? formatSchedule(campaign?.scheduleEndAt) : null;
  const continuous = start !== null && campaign?.scheduleEndAt === null;
  return <section className={embedded ? "space-y-2 px-3 pb-3 sm:px-4" : formSection} aria-label="Schedule">
    {!embedded && <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="size-4 text-muted-foreground" aria-hidden />Schedule</h3>
      <Badge variant="outline">เวลาไทย (UTC+7) · อ่านอย่างเดียว</Badge>
    </div>}
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
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="min-h-10 cursor-pointer px-3 py-2.5 text-sm font-medium sm:px-4">ประวัติการทำงานและการแจ้ง LINE</summary>
    {open && <div className="px-3 pb-2 sm:px-4"><AutoDiagnosticsPanel userId={userId} /></div>}
  </details>;
}

type CreatorEditPanelProps = {
  client: AutomationClient;
  campaign: CreatorEditCampaign;
  actualRoi: number | null;
  userId: number;
  now: number;
  onBack: () => void;
  onRefreshCampaign: () => void;
  onSync: () => Promise<AutomationOverview | null>;
};

function CreatorEditAutoSettings({ clientId, userId, campaignId, blockAutoStart }: {
  clientId: BudgetCapClientId; userId: number; campaignId: string | null; blockAutoStart: boolean;
}) {
  return <AutoBudgetStatusPanel variant="campaign-form" clientId={clientId} userId={userId}
    campaignId={campaignId} blockAutoStart={blockAutoStart} />;
}

function CreatorCampaignEditBody({ client, campaign, actualRoi, userId, now, onBack, onRefreshCampaign, onSync }: CreatorEditPanelProps) {
  const [clock, setClock] = useState<number | null>(null);
  const time = Math.max(now, clock ?? now);
  const maySync = campaign.operationStatus === "ENABLE" && notPastScheduleEnd(campaign.scheduleEndAt, time);
  const autoSync = useQuery({
    queryKey: ["automation", "edit-snapshot", userId, client.clientId, client.advertiserId, client.tiktokAccountId, campaign.campaignId, bangkokDay(time)],
    queryFn: async () => resolveCreatorEditSnapshot(await onSync(), client, campaign, Date.now()),
    enabled: maySync,
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: "always",
    refetchInterval: (query) => query.state.data ? 60_000 : 30_000,
  });
  const currentTime = Math.max(time, autoSync.dataUpdatedAt);
  const latest = maySync && autoSync.isSuccess ? autoSync.data : null;
  // Use the freshest exact snapshot without ignoring a newer overview that says
  // this account/campaign is no longer available.
  const readAt = Date.parse(client.observedAt ?? "");
  const syncAt = Date.parse(latest?.client.observedAt ?? "");
  const resolvedClient = latest && client.access === "verified" && syncAt > readAt ? latest.client : client;
  const activeCampaign = findEditableCreatorCampaign(resolvedClient, campaign, currentTime);
  const exactSync = activeCampaign ? latest?.proof ?? null : null;
  const scope = creatorEditControlScope(resolvedClient, exactSync, currentTime);
  const settings = activeCampaign ?? campaign;
  const roiText = actualRoi !== null && Number.isFinite(actualRoi) && actualRoi >= 0 ? `${formatValue(actualRoi, "ratio")}×` : "—";
  const statusText = campaign.operationStatus === "ENABLE" ? maySync ? "เปิด" : "จบแล้ว" : campaign.operationStatus === "DISABLE" ? "ปิด" : "ลบแล้ว";

  useEffect(() => {
    if (!maySync) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [maySync]);

  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="min-h-10 px-2"><ArrowLeft className="size-4" aria-hidden />กลับไปรายการ</Button>
    </div>
    <CreatorCampaignFormSection title="ตั้งค่าแคมเปญ" tag="แก้ไข">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="min-w-0 flex-1 basis-44">
          <p className="break-words text-sm font-medium">{settings.campaignName}</p>
          <p className="break-all text-xs text-muted-foreground">Campaign ID: {campaign.campaignId} · {statusText}</p>
        </div>
        <dl className="min-w-24 rounded-md bg-muted/45 px-2.5 py-1.5">
          <dt className="text-xs text-muted-foreground">ROI จริงวันนี้</dt>
          <dd className="font-semibold tabular-nums">{roiText}</dd>
        </dl>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {!maySync ? "อ่านอย่างเดียว · การเปิดแคมเปญเดิมอยู่ในหน้ารายการ"
          : scope.syncCurrent ? "ข้อมูลล่าสุดพร้อมแล้ว"
            : autoSync.isFetching || autoSync.isPending ? "กำลังอ่านข้อมูลล่าสุดจาก TikTok…"
              : "ยังยืนยันแคมเปญล่าสุดไม่ได้ · ระบบจะลองอ่านใหม่อัตโนมัติ"}
      </p>
    </CreatorCampaignFormSection>
    <div className={settingsGrid} data-layout="campaign-settings-grid">
      {activeCampaign && scope.campaignControl ? <CampaignControlPanel layout="roi-field" selectedCampaignId={campaign.campaignId}
        fallbackRoi={settings.targetRoi ?? null} userId={userId} actionsEnabled={scope.syncCurrent}
        syncedCampaignId={exactSync?.campaignId} onVerified={onRefreshCampaign} /> : <ReadOnlySetting label="LIVE ROI Target" unit="×"
          value={settings.targetRoi == null ? null : formatValue(settings.targetRoi, "ratio")}>
        {activeCampaign && <p className="text-xs text-muted-foreground">บัญชีนี้ยังแก้ ROI Target จากเว็บไม่ได้</p>}
      </ReadOnlySetting>}
      {activeCampaign && scope.budgetClientId ? <ManualBudgetPanel variant="campaign-form"
        renderBetweenBudgetAndCeiling={(blockAutoStart) => scope.autoClientId && <CreatorEditAutoSettings clientId={scope.autoClientId}
          userId={userId} campaignId={scope.autoCampaignId} blockAutoStart={blockAutoStart} />}
        userId={userId} clientId={scope.budgetClientId} active={scope.syncCurrent} clients={[resolvedClient]} onRefreshCampaign={onRefreshCampaign} /> : <ReadOnlySetting label="Daily budget" unit="THB"
          value={settings.dailyBudgetMinor == null ? null : formatValue(settings.dailyBudgetMinor / 100, "decimal")} />}
    </div>
    {activeCampaign && !scope.budgetClientId && scope.autoClientId && <CreatorEditAutoSettings clientId={scope.autoClientId}
      userId={userId} campaignId={scope.autoCampaignId} blockAutoStart={false} />}
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      <details>
        <summary className="min-h-10 cursor-pointer px-3 py-2.5 text-sm font-medium sm:px-4">Schedule และชื่อแคมเปญ <span className="text-xs font-normal text-muted-foreground">· เวลาไทย · อ่านอย่างเดียว</span></summary>
        <CreatorCampaignSchedule campaign={settings} embedded />
      </details>
      {activeCampaign && <details>
        <summary className="min-h-10 cursor-pointer px-3 py-2.5 text-sm font-medium sm:px-4">ดูสัดส่วนงบที่ใช้วันนี้</summary>
        <div className="px-3 pb-2 sm:px-4"><CreatorEditBudgetMeter campaign={activeCampaign} /></div>
      </details>}
      {activeCampaign && scope.autoClientId === PILOT_BUDGET_CLIENT_ID && <CreatorAutoDiagnostics userId={userId} />}
    </div>
  </div>;
}

export function CreatorCampaignEditPanel(props: CreatorEditPanelProps) {
  if (isMonitoringOnlyCreator(props.client)) return null;
  const { userId, client, campaign } = props;
  return <CreatorCampaignEditBody key={JSON.stringify([userId, client.clientId, client.advertiserId, client.tiktokAccountId, campaign.campaignId])} {...props} />;
}
