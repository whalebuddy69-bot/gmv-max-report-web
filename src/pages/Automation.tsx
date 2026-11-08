import { lazy, Suspense, useRef, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Activity, ArrowLeft, ArrowRight, ChevronRight, Clock3, History, LockKeyhole, RefreshCw, Settings2, Users } from "lucide-react";
import { fetchAutomationOverview, fetchAutomationPerformance, PILOT_BUDGET_CLIENT_ID, type AutomationClient, type AutomationCampaign, type AutomationOverview, type AutomationPerformance } from "@/api/automation";
import type { CampaignControlAction } from "@/api/automationCampaign";
import { isAdditionalBudgetCapClientId } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { AutoBudgetStatusPanel } from "@/components/automation/AutoBudgetStatusPanel";
import { AutoDiagnosticsPanel } from "@/components/automation/AutoDiagnosticsPanel";
import { CampaignControlPanel } from "@/components/automation/CampaignControlPanel";
import { CreatorHistoricalPerformance } from "@/components/automation/CreatorHistoricalPerformance";
import { ManualBudgetPanel } from "@/components/automation/ManualBudgetPanel";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BANGKOK, creatorRowPerformance, formatHour, isFreshAutomationClient, summarizeCreatorPerformance, toHourlyChart, type AutomationMetric } from "@/lib/automation";
import { formatValue } from "@/lib/format";
import { useAuthStore } from "@/store/authStore";

const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
const CreatorHourlyChart = lazy(() => import("@/components/automation/CreatorHourlyChart"));
const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });
const formatTime = (date: string | null) => date === null ? "ยังไม่มีข้อมูล" : time.format(new Date(date));
const SECTION = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
const METRICS = {
  spendMinor: { label: "ยอดใช้จ่าย", format: "currency", unit: "บาท" },
  gmvMinor: { label: "GMV", format: "currency", unit: "บาท" },
  roi: { label: "ROI", format: "ratio", unit: "เท่า" },
  orders: { label: "ออเดอร์", format: "integer", unit: "ออเดอร์" },
  liveViews: { label: "LIVE Views", format: "integer", unit: "ครั้ง" },
} as const;

function stopPolling(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
}

function Stats({ clients, now }: { clients: AutomationClient[]; now: number }) {
  const verified = clients.filter((client) => isFreshAutomationClient(client, now));
  const enabled = verified.filter((client) => client.campaign !== null);
  const stats = [
    { label: "บัญชีที่ตั้งค่า", value: clients.length },
    { label: "อ่านข้อมูลได้", value: verified.length },
    { label: "แคมเปญเปิดอยู่", value: enabled.length },
  ];
  return (
    <dl aria-label="สรุปบัญชี Creator" className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card">
      {stats.map(({ label, value }) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2 sm:px-4">
          <dt className="break-words text-xs font-medium text-muted-foreground sm:text-sm">{label}</dt>
          <dd className="tabular text-lg font-semibold leading-none sm:text-xl">{number.format(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AccessStatus({ client, now }: { client: AutomationClient; now: number }) {
  if (client.access !== "verified") {
    const label = client.accessReason === "needs-authorization" ? "รออนุญาตบัญชี"
      : client.accessReason === "identity-unverified" ? "รอยืนยันตัวตน Creator"
        : client.accessReason === "upstream-unavailable" ? "ข้อมูลจาก TikTok ยังไม่พร้อม" : "ยังยืนยันการเข้าถึงไม่ได้";
    return <Badge variant="outline" className="whitespace-normal">{label}</Badge>;
  }
  if (!isFreshAutomationClient(client, now)) return <Badge variant="warning">ข้อมูลเก่า</Badge>;
  return <Badge variant="success">อ่านข้อมูลได้</Badge>;
}

function CreatorDetails({ client, campaign }: { client: AutomationClient; campaign: AutomationCampaign | null }) {
  return (
    <dl className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3 text-xs sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Ad Account ID</dt><dd className="mt-1 break-all font-mono">{client.advertiserId}</dd></div>
      <div>
        <dt className="text-muted-foreground">TikTok Account ID{client.tiktokAccountIdVerified === false ? " (ตามที่แจ้ง)" : ""}</dt>
        <dd className="mt-1 break-all font-mono">{client.tiktokAccountId}</dd>
        {client.tiktokAccountIdVerified === false && <dd className="mt-1 text-muted-foreground">API ยังไม่ได้ยืนยันเลขนี้โดยตรง</dd>}
      </div>
      {campaign && <div><dt className="text-muted-foreground">Campaign ID</dt><dd className="mt-1 break-all font-mono">{campaign.campaignId}</dd></div>}
      <div><dt className="text-muted-foreground">อ่านสถานะล่าสุด · เวลาไทย</dt><dd className="mt-1">{formatTime(client.observedAt)}</dd></div>
    </dl>
  );
}

export function BudgetMeter({ campaign }: { campaign: AutomationCampaign }) {
  const percent = campaign.spendMinor === null ? null : (campaign.spendMinor / campaign.dailyBudgetMinor) * 100;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <p className="font-medium">ใช้งบวันนี้</p>
        <p className="tabular text-muted-foreground">
          {percent === null ? "ยังยืนยันยอดใช้ไม่ได้" : `${number.format(percent)}% ของงบแคมเปญ`}
        </p>
      </div>
      {percent !== null && (
        <div
          className="relative mt-2 h-2.5 rounded-full bg-muted"
          role="meter"
          aria-label="สัดส่วนงบที่ใช้วันนี้"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
          aria-valuetext={`${number.format(percent)}% ของงบแคมเปญ เกณฑ์แจ้งเตือน 80%`}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
          <span className="absolute -top-0.5 h-3.5 w-0.5 bg-foreground" style={{ left: "80%" }} aria-hidden />
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        เส้น 80% คือเกณฑ์ยอดใช้ Auto ไม่ได้เพิ่มงบเพียงเพราะถึงเส้นนี้
      </p>
    </div>
  );
}

function PerformancePanel({ client, result, payload }: {
  client: AutomationClient;
  result: UseQueryResult<AutomationPerformance, Error>;
  payload: AutomationPerformance | null;
}) {
  const [metric, setMetric] = useState<AutomationMetric>("spendMinor");
  const rows = payload?.state === "available" ? toHourlyChart(payload.series, metric) : [];
  const metricInfo = METRICS[metric];
  const hasValues = rows.some(({ value }) => value !== null);
  return (
    <section className={SECTION} aria-labelledby="automation-performance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="automation-performance" className="text-base font-semibold">Performance รายชั่วโมง</h2>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {client.displayName} · {client.reportingDate} · รายงาน Creator จาก TikTok
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => void result.refetch()} disabled={result.isFetching || stopPolling(result.error)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> อัปเดตกราฟ
        </Button>
      </div>
      <label className="mt-4 inline-flex flex-wrap items-center gap-2 text-sm font-medium">
        ตัวชี้วัด
        <select
          value={metric}
          onChange={(event) => setMetric(event.target.value as AutomationMetric)}
          className="min-h-10 max-w-full rounded-md border border-input bg-background px-2 text-base sm:text-sm"
        >
          {Object.entries(METRICS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
      </label>
      {result.isPending ? <LoadingState label="กำลังอ่านรายงานรายชั่วโมง…" /> : result.isError ? (
        stopPolling(result.error) ? <EmptyState title="ยังเปิดกราฟสำหรับบัญชีนี้ไม่ได้" description="ไม่มีสิทธิ์หรือยังไม่ได้เปิดส่วนรายงาน Automation" /> :
          <ErrorState error={result.error} onRetry={() => void result.refetch()} />
      ) : !payload ? (
        <EmptyState title="ยังไม่มีรายงานล่าสุดที่ยืนยันได้สำหรับแคมเปญนี้" description="ระบบจะไม่แสดงตัวเลขเก่า ของแคมเปญเดิม หรือของวันอื่น" />
      ) : payload.state === "no-active-campaign" ? (
        <EmptyState title="ไม่พบแคมเปญที่เปิดอยู่ในรายงานล่าสุด" />
      ) : payload.state === "unavailable" ? (
        <EmptyState title="TikTok ยังไม่ส่งรายงานที่ยืนยันได้" description="ไม่ได้หมายความว่า Performance เป็นศูนย์" />
      ) : !hasValues ? (
        <EmptyState title={`ยังไม่มีค่า ${metricInfo.label} รายชั่วโมงที่ยืนยันได้`} description="ช่องที่ไม่มีข้อมูลจะไม่แสดงเป็นศูนย์" />
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground">หน่วย: {metricInfo.unit} · ชั่วโมงตามป้ายเวลาที่ TikTok ส่งมา</p>
          <Suspense fallback={<p className="mt-2 text-sm text-muted-foreground">กำลังโหลดกราฟ…</p>}>
            <CreatorHourlyChart rows={rows} label={metricInfo.label} format={metricInfo.format} />
          </Suspense>
          <details className="mt-2 rounded-md border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">ดูตัวเลขรายชั่วโมง</summary>
            <table className="mt-2 w-full">
              <thead><tr className="border-b text-left"><th className="py-1 font-medium" scope="col">ชั่วโมง</th><th className="py-1 text-right font-medium" scope="col">{metricInfo.label}</th></tr></thead>
              <tbody>
                {rows.map(({ minute, value }) => <tr key={minute} className="border-b last:border-0"><td className="tabular py-1">{formatHour(minute)}</td><td className="tabular py-1 text-right">{value === null ? "ไม่มีข้อมูล" : formatValue(value, metricInfo.format)}</td></tr>)}
              </tbody>
            </table>
          </details>
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        GMV, ROI และออเดอร์อิงยอดที่ TikTok ผูกกับแคมเปญ ไม่ใช่ยอดรวมของร้าน · ROI Target ไม่ใช่ ROI จริง
        {payload?.observedAt ? ` · อ่านจาก TikTok ${formatTime(payload.observedAt)} (เวลาไทย)` : ""}
      </p>
    </section>
  );
}

function RowValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-tight text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

const STAGES = [
  { id: 1, label: "เลือกบัญชี", icon: Users },
  { id: 2, label: "Sync & ตั้งค่า", icon: Settings2 },
  { id: 3, label: "Optimize & ดูผล", icon: Activity },
  { id: 4, label: "ย้อนหลัง", icon: History },
] as const;
type CreatorStage = 2 | 3 | 4;
export type AutomationFlow = { clientId: string; stage: CreatorStage } | null;
type AutomationFlowAction =
  | { type: "select"; clientId: string }
  | { type: "clear" }
  | { type: "navigate"; clientId: string; stage: CreatorStage }
  | { type: "verified-launch"; clientId: string };

export function transitionAutomationFlow(flow: AutomationFlow, action: AutomationFlowAction, clients: readonly AutomationClient[]): AutomationFlow {
  if (action.type === "clear") return null;
  const known = clients.some((client) => client.clientId === action.clientId);
  if (action.type === "select") return known ? { clientId: action.clientId, stage: 2 } : flow;
  // In-flight work from a previously selected account must not move a new
  // account to another stage when it resolves.
  if (!flow || flow.clientId !== action.clientId) return flow;
  if (!known) return null;
  return { ...flow, stage: action.type === "verified-launch" ? 3 : action.stage };
}

type SyncedCreator = {
  clientId: string;
  advertiserId: string;
  tiktokAccountId: string;
  reportingDate: string | null;
  campaignId: string | null;
  observedAt: string | null;
};
export function syncedCreatorFromOverview(overview: AutomationOverview | null, client: AutomationClient, now: number): SyncedCreator | null {
  const observed = overview?.clients.find((value) => value.clientId === client.clientId);
  if (!observed || observed.advertiserId !== client.advertiserId || observed.tiktokAccountId !== client.tiktokAccountId ||
      !isFreshAutomationClient(observed, now)) return null;
  return {
    clientId: observed.clientId, advertiserId: observed.advertiserId, tiktokAccountId: observed.tiktokAccountId,
    reportingDate: observed.reportingDate, campaignId: observed.campaign?.campaignId ?? null, observedAt: observed.observedAt,
  };
}

export function isCurrentCreatorSync(sync: SyncedCreator | null, client: AutomationClient, now: number) {
  return !!sync && isFreshAutomationClient(client, now) && sync.clientId === client.clientId &&
    sync.advertiserId === client.advertiserId && sync.tiktokAccountId === client.tiktokAccountId &&
    sync.reportingDate === client.reportingDate && sync.campaignId === (client.campaign?.campaignId ?? null) &&
    isFreshAutomationClient({ ...client, observedAt: sync.observedAt }, now);
}

function StageNavigation({ stage, hasAccount, onStage }: { stage: 1 | CreatorStage; hasAccount: boolean; onStage: (id: 1 | CreatorStage) => void }) {
  return (
    <nav aria-label="ขั้นตอน Automation">
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {STAGES.map(({ id, label, icon: Icon }) => <li key={id} className="min-w-0">
          <Button type="button" variant={stage === id ? "secondary" : "outline"} className="h-auto min-h-12 w-full justify-start gap-2 whitespace-normal px-2.5 text-left sm:px-3"
            disabled={id !== 1 && !hasAccount} aria-current={stage === id ? "step" : undefined} onClick={() => onStage(id)}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold">{id}</span>
            <Icon className="hidden h-4 w-4 shrink-0 md:block" aria-hidden />
            <span className="min-w-0 break-words">{label}</span>
          </Button>
        </li>)}
      </ol>
    </nav>
  );
}

function CreatorSelection({ clients, now, onSelect }: { clients: AutomationClient[]; now: number; onSelect: (clientId: string) => void }) {
  const [filter, setFilter] = useState("");
  const search = filter.trim().toLocaleLowerCase();
  const visible = search ? clients.filter((client) => [client.displayName, client.clientId, client.advertiserId].some((value) => value.toLocaleLowerCase().includes(search))) : clients;
  return (
    <>
      <Stats clients={clients} now={now} />
      <section className={SECTION} aria-labelledby="automation-creators">
        <h2 id="automation-creators" className="text-base font-semibold">เลือกบัญชี Creator</h2>
        <p className="mt-1 text-sm text-muted-foreground">แสดงทุกบัญชีที่ตั้งค่าไว้ใน Automation · เลือกหนึ่งบัญชีเพื่อ Sync และจัดการ</p>
        {clients.length > 4 && <label className="mt-3 block text-sm font-medium">
          ค้นหาบัญชี
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)}
            placeholder="ชื่อ Creator หรือ Ad Account ID"
            className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:max-w-sm sm:text-sm" />
        </label>}
        {clients.length === 0 ? (
          <p className="mt-4 rounded-md bg-muted px-3 py-3 text-sm">ยังไม่มีบัญชี Creator ที่ตั้งค่าให้ดูใน Automation</p>
        ) : visible.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">ไม่พบชื่อหรือรหัสบัญชีที่ค้นหา</p>
        ) : (
          <ul className="mt-3 grid min-w-0 gap-2" aria-label="บัญชี Creator">
            {visible.map((client) => {
              const fresh = isFreshAutomationClient(client, now);
              const active = fresh ? client.campaign : null;
              return <li key={client.clientId} className="min-w-0">
                <Button type="button" variant="outline" className="grid h-auto min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] justify-start gap-2 whitespace-normal p-3 text-left sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  aria-label={`เลือก ${client.displayName}`} onClick={() => onSelect(client.clientId)}>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-semibold">{client.displayName}</span>
                    <span className="mt-0.5 block break-words text-xs font-normal text-muted-foreground">{active?.campaignName ?? (fresh ? "ไม่พบแคมเปญที่เปิด" : "ยังไม่ยืนยันสถานะแคมเปญ")}</span>
                  </span>
                  <span className="hidden max-w-44 sm:block"><AccessStatus client={client} now={now} /></span>
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="col-span-2 sm:hidden"><AccessStatus client={client} now={now} /></span>
                </Button>
              </li>;
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function SelectedCreatorStages({ client, stage, userId, now, onSync, onStage, onLaunchVerified, onRefreshCampaign }: {
  client: AutomationClient;
  stage: CreatorStage;
  userId: number;
  now: number;
  onSync: () => Promise<AutomationOverview | null>;
  onStage: (id: CreatorStage) => void;
  onLaunchVerified: () => void;
  onRefreshCampaign: () => void;
}) {
  const [sync, setSync] = useState<SyncedCreator | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const syncLock = useRef(false);
  const syncValid = isCurrentCreatorSync(sync, client, now);
  const verified = isFreshAutomationClient(client, now);
  const campaign = verified ? client.campaign : null;
  const performanceEnabled = stage !== 2 && campaign !== null;
  const query = useQuery({
    queryKey: ["automation", "performance", userId, client.clientId, campaign?.campaignId, client.reportingDate],
    queryFn: ({ signal }) => fetchAutomationPerformance(client.clientId, signal),
    enabled: performanceEnabled,
    gcTime: 0,
    retry: false,
    staleTime: 120_000,
    refetchInterval: (state) => stage !== 3 || !performanceEnabled || stopPolling(state.state.error) ? false : 180_000,
    refetchIntervalInBackground: false,
  });
  const payload = performanceEnabled && query.isSuccess ? creatorRowPerformance(query.data, client, now) : null;
  const totals = payload?.state === "available" && payload.series.length > 0 ? summarizeCreatorPerformance(payload.series) : null;
  const budgetClientId = isAdditionalBudgetCapClientId(client.clientId) ? client.clientId
    : client.clientId === PILOT_BUDGET_CLIENT_ID && client.budgetControlAvailable !== false ? PILOT_BUDGET_CLIENT_ID : null;
  // Stop remains available on Stage 3 even when the campaign disappeared or
  // when Sync could not confirm fresh numbers. The scoped server checks rights.
  const autoClientId = client.clientId === PILOT_BUDGET_CLIENT_ID ? PILOT_BUDGET_CLIENT_ID : budgetClientId;
  const ppan = client.clientId === PILOT_BUDGET_CLIENT_ID;

  async function syncSelectedAccount() {
    if (syncLock.current) return;
    syncLock.current = true;
    setSync(null); setSyncing(true); setSyncFailed(false);
    try {
      const result = syncedCreatorFromOverview(await onSync(), client, Date.now());
      setSync(result);
      setSyncFailed(result === null);
    } catch { setSyncFailed(true); }
    finally { syncLock.current = false; setSyncing(false); }
  }

  function verifiedCampaignAction(action: CampaignControlAction) {
    onRefreshCampaign();
    if (action === "RESUME") onLaunchVerified();
  }

  return (
    <>
      {stage === 2 && <section className={SECTION} aria-labelledby="automation-setup">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="automation-setup" className="text-base font-semibold">Sync & ตั้งค่า</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sync เพื่ออ่านข้อมูลล่าสุดของบัญชีนี้ ไม่เปิดแอดและไม่เปลี่ยนงบ</p>
          </div>
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={syncing} onClick={() => void syncSelectedAccount()}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden /> {syncing ? "กำลัง Sync…" : "Sync บัญชีนี้"}
          </Button>
        </div>
        <div className="mt-3 min-w-0 rounded-lg border border-border bg-muted/30 p-3 text-sm" role="status">
          {syncValid ? <>
            <p className="font-medium">Sync สำเร็จ · {client.displayName}</p>
            <p className="mt-1 break-words text-muted-foreground">{campaign ? campaign.campaignName : "ไม่พบแคมเปญที่เปิดในข้อมูลล่าสุด"} · TikTok อ่านล่าสุด {formatTime(sync?.observedAt ?? null)}</p>
          </> : <p className="text-muted-foreground">{syncing ? "กำลังตรวจบัญชีและแคมเปญกับระบบ…" :
            syncFailed ? "ยังยืนยันข้อมูลล่าสุดของบัญชีนี้ไม่ได้ กรุณาลอง Sync อีกครั้ง" :
              sync ? "ข้อมูลบัญชีหรือแคมเปญเปลี่ยนหรือหมดอายุ กรุณา Sync ใหม่" : "ยังไม่ได้ Sync ในขั้นตอนนี้"}</p>}
        </div>
        {syncValid && <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => onStage(3)}>
            ไปยัง Optimize & ดูผล <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <span className="text-xs text-muted-foreground">ไปดูสถานะได้โดยไม่ส่งคำสั่งเปิดแอด</span>
        </div>}
        <details className="mt-3 rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">ข้อมูลบัญชีและรหัสแคมเปญ</summary>
          <div className="mt-2"><CreatorDetails client={client} campaign={campaign} /></div>
        </details>
      </section>}
      {budgetClientId && <details hidden={stage !== 2} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
        <summary className="cursor-pointer text-sm font-semibold">ปรับงบ / ตั้งเพดาน / ตรวจผลรายการเดิม</summary>
        {!syncValid && <p className="mt-2 text-xs text-muted-foreground">Sync ก่อนปรับงบหรือเพดาน แต่ยังตรวจผลรายการเดิมได้</p>}
        <div className="mt-3">
          <ManualBudgetPanel userId={userId} clientId={budgetClientId} active={stage === 2 && syncValid} clients={[client]} onRefreshCampaign={onRefreshCampaign} />
        </div>
      </details>}
      {stage === 2 && <section className={SECTION} aria-labelledby="automation-launch">
        <h2 id="automation-launch" className="text-base font-semibold">แคมเปญและการเปิดแอด</h2>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {ppan ? "ยังไม่รองรับสร้างแคมเปญ Creator ใหม่จากหน้านี้ คำสั่งแคมเปญเดิมจะใช้ได้เมื่อระบบรองรับและต้องยืนยันแยก"
            : "บัญชีนี้ยังไม่รองรับคำสั่งเปิดหรือพักแคมเปญจาก Automation"}
        </p>
        {ppan && <div className="mt-3"><CampaignControlPanel userId={userId} actionsEnabled={syncValid}
          syncedCampaignId={sync?.campaignId} onVerified={verifiedCampaignAction} /></div>}
      </section>}
      {stage === 3 && <>
        <section className={SECTION} aria-labelledby="automation-current">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="automation-current" className="text-base font-semibold">Performance ล่าสุด</h2>
              <p className="mt-1 text-xs text-muted-foreground">TikTok อ่านล่าสุด {formatTime(client.observedAt)} · ตัวเลขรายงานอาจล่าช้า ไม่ใช่ยอดเรียลไทม์</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => onStage(2)}>ตั้งงบ / เพดาน</Button>
          </div>
          {campaign ? <>
            <p className="mt-3 break-words text-sm font-medium">{campaign.campaignName}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="งบและ Performance ล่าสุด">
              <RowValue label="งบปัจจุบัน" value={formatValue(campaign.dailyBudgetMinor / 100, "currency")} />
              <RowValue label="ยอดใช้ (ประมาณ)" value={formatValue(campaign.spendMinor == null ? null : campaign.spendMinor / 100, "currency")} />
              <RowValue label="ROI Target" value={campaign.targetRoi == null ? "–" : `${number.format(campaign.targetRoi)}×`} />
              <RowValue label="GMV" value={formatValue(totals?.gmvMinor == null ? null : totals.gmvMinor / 100, "currency")} />
              <RowValue label="ROI จริง" value={totals?.roi == null ? "–" : `${formatValue(totals.roi, "ratio")}×`} />
              <RowValue label="ออเดอร์" value={formatValue(totals?.orders, "integer")} />
              <RowValue label="LIVE Views" value={formatValue(totals?.liveViews, "integer")} />
            </dl>
            <BudgetMeter campaign={campaign} />
          </> : <p className="mt-3 text-sm text-muted-foreground">{verified ? "ไม่พบแคมเปญที่เปิดอยู่" : "ยังไม่มีข้อมูลล่าสุดที่ยืนยันได้"} · ยังตรวจสถานะ Auto ด้านล่างได้</p>}
        </section>
        {autoClientId && <section className={SECTION} aria-labelledby="automation-optimize">
          <h2 id="automation-optimize" className="mb-2 text-base font-semibold">Ads Optimization</h2>
          <AutoBudgetStatusPanel clientId={autoClientId} userId={userId} campaignId={campaign?.campaignId ?? null} />
          {ppan && <div className="mt-3"><AutoDiagnosticsPanel userId={userId} /></div>}
        </section>}
        {campaign && <PerformancePanel key={`${campaign.campaignId}:${client.reportingDate}`} client={client} result={query} payload={payload} />}
      </>}
      {stage === 4 && <CreatorHistoricalPerformance client={client} result={query} payload={payload} />}
    </>
  );
}

export function AutomationWorkspace({ data, userId, now, onSync, onRefreshCampaign, initialFlow = null }: {
  data: AutomationOverview;
  userId: number;
  now: number;
  onSync: () => Promise<AutomationOverview | null>;
  onRefreshCampaign: () => void;
  initialFlow?: AutomationFlow;
}) {
  const [flow, setFlow] = useState<AutomationFlow>(initialFlow);
  const client = flow ? data.clients.find((row) => row.clientId === flow.clientId) ?? null : null;
  const stage = client && flow ? flow.stage : 1;
  function dispatch(action: AutomationFlowAction) {
    setFlow((current) => transitionAutomationFlow(current, action, data.clients));
  }
  function changeStage(id: 1 | CreatorStage) {
    if (id === 1) dispatch({ type: "clear" });
    else if (client) dispatch({ type: "navigate", clientId: client.clientId, stage: id });
  }

  return (
    <>
      <StageNavigation stage={stage} hasAccount={client !== null} onStage={changeStage} />
      {client && stage !== 1 ? <>
        <section className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3" aria-label="บัญชีที่เลือก">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">บัญชีที่เลือก</p>
            <p className="break-words text-base font-semibold">{client.displayName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AccessStatus client={client} now={now} />
            <Button type="button" variant="ghost" size="sm" className="min-h-10" onClick={() => changeStage(1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> เปลี่ยนบัญชี
            </Button>
          </div>
        </section>
        <SelectedCreatorStages key={`${userId}:${client.clientId}`} client={client} stage={stage} userId={userId} now={now}
          onSync={onSync} onStage={changeStage} onRefreshCampaign={onRefreshCampaign}
          onLaunchVerified={() => dispatch({ type: "verified-launch", clientId: client.clientId })} />
      </> : <CreatorSelection clients={data.clients} now={now} onSelect={(clientId) => dispatch({ type: "select", clientId })} />}
    </>
  );
}

export function AutomationPage() {
  const userId = useAuthStore((state) => state.user?.id);
  const overview = useQuery({
    queryKey: ["automation", "overview", userId],
    queryFn: ({ signal }) => fetchAutomationOverview(signal),
    enabled: userId !== undefined,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => stopPolling(query.state.error) ? false : 60_000,
  });
  // Transient overview errors must not hide Stop for a selected account.
  // Revoked credentials are different: do not render retained account data.
  const data = !stopPolling(overview.error) ? overview.data ?? null : null;
  const now = Date.now();
  async function syncOverview() {
    const refreshed = await overview.refetch();
    return refreshed.isSuccess ? refreshed.data ?? null : null;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/35">
      <div className="mx-auto grid max-w-5xl gap-3 p-3 sm:gap-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
              <Badge variant="secondary">Creator · LIVE GMV Max</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">เลือกบัญชี ตั้งค่า ดูผล และ Optimize ในหน้าเดียว</p>
          </div>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => void overview.refetch()} disabled={overview.isFetching || stopPolling(overview.error)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> อัปเดตสถานะ
          </Button>
        </div>
        {overview.isPending ? <LoadingState label="กำลังตรวจสอบสิทธิ์และสถานะแคมเปญ…" /> : overview.isError && !data ? (
          <div className={SECTION}>
            {overview.error instanceof ApiError && overview.error.status === 403 ? (
              <EmptyState title="บัญชีนี้ยังไม่ได้รับสิทธิ์ Automation" description="สิทธิ์ดูรายงานเดิมไม่เท่ากับสิทธิ์ดูข้อมูล Creator กรุณาติดต่อผู้ดูแล" />
            ) : overview.error instanceof ApiError && overview.error.status === 404 ? (
              <EmptyState title="ยังไม่ได้เปิดแหล่งข้อมูล Automation" description="แท็บนี้จะไม่แสดงข้อมูลตัวอย่างเป็นสถานะจริง" />
            ) : <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}
          </div>
        ) : data ? (
          <>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4" aria-hidden /> ตรวจข้อมูลล่าสุด {formatTime(data.checkedAt)} (เวลาไทย) · อัปเดตประมาณทุก 1 นาที
            </p>
            {overview.isError && <p role="status" className="text-xs text-muted-foreground">รีเฟรชภาพรวมไม่สำเร็จ · คำสั่งยังต้องตรวจข้อมูลและสิทธิ์ล่าสุด</p>}
            {userId !== undefined && <AutomationWorkspace key={userId} data={data} userId={userId} now={now}
              onSync={syncOverview} onRefreshCampaign={() => void overview.refetch()} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
