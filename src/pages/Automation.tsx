import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, ChevronDown, CirclePause, CirclePlay, Clock3, LockKeyhole, RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchAutomationOverview, fetchAutomationPerformance, PILOT_BUDGET_CLIENT_ID, type AutomationClient, type AutomationCampaign, type AutomationPerformance } from "@/api/automation";
import { isAdditionalBudgetCapClientId } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { AutoBudgetStatusPanel } from "@/components/automation/AutoBudgetStatusPanel";
import { ManualBudgetPanel } from "@/components/automation/ManualBudgetPanel";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BANGKOK, creatorRowPerformance, formatHour, isFreshAutomationClient, summarizeCreatorPerformance, toHourlyChart, type AutomationMetric } from "@/lib/automation";
import { formatCompact, formatValue } from "@/lib/format";
import { useAuthStore } from "@/store/authStore";

const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });
const formatTime = (date: string | null) => date === null ? "ยังไม่มีข้อมูล" : time.format(new Date(date));
const SECTION = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
const ROW_COLUMNS = "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto]";
const EAGER_PERFORMANCE_LIMIT = 8;
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
    { label: "บัญชีที่ตั้งค่าแล้ว", value: clients.length, hint: "เฉพาะ Creator ที่เชื่อมกับระบบ" },
    { label: "ยืนยันการเข้าถึงแล้ว", value: verified.length, hint: "อ่านข้อมูลได้และยังเป็นข้อมูลล่าสุด" },
    { label: "แคมเปญเปิดอยู่", value: enabled.length, hint: "สถานะเปิด ไม่ใช่หลักฐานว่ากำลังไลฟ์" },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {stats.map(({ label, value, hint }) => (
        <div key={label} className={SECTION}>
          <dt className="text-sm font-medium">{label}</dt>
          <dd className="tabular mt-1 text-3xl font-semibold tracking-tight">{number.format(value)}</dd>
          <dd className="mt-1 text-sm text-muted-foreground">{hint}</dd>
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

const ACTIONS = [
  { label: "เปิด", icon: CirclePlay },
  { label: "ปิด/พัก", icon: CirclePause },
  { label: "เพิ่มงบ", icon: ArrowUp },
  { label: "ลดงบ", icon: ArrowDown },
  { label: "Auto", icon: Activity },
] as const;

export function ReadOnlyActions({ budgetPanel = false }: { budgetPanel?: boolean } = {}) {
  const actions = budgetPanel ? ACTIONS.filter(({ label }) => label === "เปิด" || label === "ปิด/พัก") : ACTIONS;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" id="automation-write-disabled">
        <LockKeyhole className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        {budgetPanel ? "เปิด/พักแคมเปญยังไม่เปิดให้ใช้งาน" : "รุ่นนี้อ่านข้อมูลเท่านั้น ปุ่มสั่งงานยังไม่เชื่อม TikTok"}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {actions.map(({ label, icon: Icon }) => (
          <Button key={label} type="button" variant="outline" size="sm" disabled aria-describedby="automation-write-disabled">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Button>
        ))}
      </div>
    </div>
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
        กฎจำลอง: ใช้ถึง 80% → เสนอเพิ่ม 20% หลังตรวจเพดาน · ยังไม่สั่งปรับงบอัตโนมัติ
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
          <div className="mt-2 h-[240px] min-w-0 sm:h-[300px]" role="img" aria-label={`กราฟ ${metricInfo.label} รายชั่วโมง`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 12, right: 14, bottom: 8, left: 2 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis type="number" dataKey="minute" domain={[0, 1439]} ticks={[0, 360, 720, 1080, 1380]} tickFormatter={formatHour} minTickGap={18} tick={{ fontSize: 11 }} />
                <YAxis width={64} tickFormatter={(value: number) => formatCompact(value, metricInfo.format)} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(value: number) => formatHour(value)}
                  formatter={(value: number) => [formatValue(value, metricInfo.format), metricInfo.label]}
                />
                <Line name={metricInfo.label} type="linear" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} connectNulls={false} dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
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

function CreatorRow({ client, userId, now, eager, expanded, onToggle, onRefreshCampaign }: {
  client: AutomationClient;
  userId: number;
  now: number;
  eager: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRefreshCampaign: () => void;
}) {
  const verified = isFreshAutomationClient(client, now);
  const campaign = verified ? client.campaign : null;
  const performanceEnabled = campaign !== null && (eager || expanded);
  const query = useQuery({
    queryKey: ["automation", "performance", userId, client.clientId, campaign?.campaignId, client.reportingDate],
    queryFn: ({ signal }) => fetchAutomationPerformance(client.clientId, signal),
    enabled: performanceEnabled,
    gcTime: 0,
    retry: false,
    staleTime: 120_000,
    refetchInterval: (state) => !performanceEnabled || stopPolling(state.state.error) ? false : 180_000,
    refetchIntervalInBackground: false,
  });
  const payload = performanceEnabled && query.isSuccess ? creatorRowPerformance(query.data, client, now) : null;
  const totals = payload?.state === "available" && payload.series.length > 0 ? summarizeCreatorPerformance(payload.series) : null;
  const spendPercent = campaign && campaign.spendMinor !== null ? 100 * campaign.spendMinor / campaign.dailyBudgetMinor : null;
  const budgetClientId = isAdditionalBudgetCapClientId(client.clientId) ? client.clientId
    : client.clientId === PILOT_BUDGET_CLIENT_ID && client.budgetControlAvailable !== false ? PILOT_BUDGET_CLIENT_ID : null;
  const detailId = `automation-creator-detail-${client.clientId}`;

  return (
    <li className="min-w-0 rounded-lg border border-border bg-card">
      <div className={`grid min-w-0 items-start gap-x-4 gap-y-3 p-3 sm:p-4 md:grid-cols-2 lg:items-center ${ROW_COLUMNS}`}>
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{client.displayName}</h3>
          <p className="mt-1 break-words text-xs text-muted-foreground">{campaign?.campaignName ?? "Creator · LIVE GMV Max"}</p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <AccessStatus client={client} now={now} />
          <span className="text-xs text-muted-foreground">
            {campaign ? "แคมเปญเปิดใช้งาน" : verified ? "ไม่พบแคมเปญที่เปิด" : "สถานะแคมเปญยังไม่ยืนยัน"}
          </span>
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-medium lg:sr-only">งบและการใช้งบ</p>
          <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
            <RowValue label="งบปัจจุบัน" value={formatValue(campaign ? campaign.dailyBudgetMinor / 100 : null, "currency")} />
            <RowValue label="ใช้ไป (ประมาณ)" value={formatValue(campaign?.spendMinor != null ? campaign.spendMinor / 100 : null, "currency")} />
            <RowValue label="ใช้ไป (%)" value={spendPercent !== null ? `${number.format(spendPercent)}%` : "–"} />
            <RowValue label="ROI Target" value={campaign?.targetRoi != null ? `${number.format(campaign.targetRoi)}×` : "–"} />
          </dl>
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-medium lg:sr-only">Performance</p>
          <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
            <RowValue label="GMV" value={formatValue(totals?.gmvMinor != null ? totals.gmvMinor / 100 : null, "currency")} />
            <RowValue label="ออเดอร์" value={formatValue(totals?.orders, "integer")} />
            <RowValue label="ROI จริง" value={totals?.roi != null ? `${formatValue(totals.roi, "ratio")}×` : "–"} />
            <RowValue label="LIVE Views" value={formatValue(totals?.liveViews, "integer")} />
          </dl>
          {campaign && !totals && <p className="mt-1.5 text-xs text-muted-foreground">
            {!performanceEnabled ? "เปิดรายละเอียดเพื่อโหลด Performance" : query.isPending ? "กำลังอ่านรายงาน…" : "ยังไม่มีรายงานล่าสุดที่ยืนยันได้"}
          </p>}
        </div>
        <Button type="button" variant="outline" size="sm" className="min-h-10 justify-self-start"
          aria-controls={detailId} aria-expanded={expanded} aria-label={`รายละเอียด ${client.displayName}`} onClick={onToggle}>
          รายละเอียด <ChevronDown className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </Button>
      </div>
      <div id={detailId} hidden={!expanded} className="border-t border-border bg-muted/25 p-3 sm:p-4">
        {expanded && <CreatorDetails client={client} campaign={campaign} />}
        {budgetClientId && <div className="mt-3">
          <ManualBudgetPanel key={`${userId}:${budgetClientId}`} userId={userId} clientId={budgetClientId} active={expanded} clients={[client]} onRefreshCampaign={onRefreshCampaign} />
          {expanded && verified && <AutoBudgetStatusPanel clientId={budgetClientId} userId={userId} campaignId={campaign?.campaignId ?? null} />}
          {expanded && campaign && budgetClientId === PILOT_BUDGET_CLIENT_ID && <BudgetMeter campaign={campaign} />}
          {expanded && <ReadOnlyActions budgetPanel />}
        </div>}
        {expanded && campaign ? (
          <div className="mt-3">
            <PerformancePanel key={`${campaign.campaignId}:${client.reportingDate}`} client={client} result={query} payload={payload} />
          </div>
        ) : expanded && (
          <p className="mt-3 text-sm text-muted-foreground">กราฟจะพร้อมเมื่อยืนยันการเข้าถึงและพบแคมเปญที่เปิดอยู่</p>
        )}
      </div>
    </li>
  );
}

export function CreatorRows({ clients, userId, now, onRefreshCampaign }: {
  clients: AutomationClient[];
  userId: number;
  now: number;
  onRefreshCampaign: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const eagerIds = new Set(clients.filter((client) => client.campaign !== null && isFreshAutomationClient(client, now))
    .slice(0, EAGER_PERFORMANCE_LIMIT).map((client) => client.clientId));

  return (
    <section className={SECTION} aria-labelledby="automation-creators">
      <h2 id="automation-creators" className="text-base font-semibold">Creator Performance</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        หนึ่งแถวต่อ Creator · เฉพาะบัญชีที่ตั้งค่าแล้ว · สถานะแคมเปญเปิดไม่ใช่หลักฐานว่ากำลังไลฟ์
      </p>
      {clients.length === 0 ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-3 text-sm">ยังไม่มีบัญชี Creator ที่ตั้งค่าให้ดูใน Automation</p>
      ) : (
        <>
          <div className={`mt-4 hidden min-w-0 items-center gap-x-4 px-4 pb-2 text-xs font-medium text-muted-foreground lg:grid ${ROW_COLUMNS}`} aria-hidden>
            <span>Creator / แคมเปญ</span><span>การเข้าถึง / สถานะ</span><span>งบและการใช้งบ</span><span>Performance</span><span className="w-[94px]" />
          </div>
          <ul className="mt-3 grid min-w-0 gap-2 lg:mt-0" aria-label="แถว Creator">
            {clients.map((client) => (
              <CreatorRow key={client.clientId} client={client} userId={userId} now={now}
                eager={eagerIds.has(client.clientId)} expanded={expandedId === client.clientId}
                onToggle={() => setExpandedId((current) => current === client.clientId ? null : client.clientId)}
                onRefreshCampaign={onRefreshCampaign} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Performance รวมเฉพาะชั่วโมงที่ TikTok ส่งมา · ROI จริง = GMV ÷ ยอดใช้ของชั่วโมงชุดเดียวกัน · ขีดหมายถึงยังไม่มีข้อมูล ไม่ใช่ศูนย์
          </p>
        </>
      )}
    </section>
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
  const data = overview.isSuccess ? overview.data : null;
  const now = Date.now();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/35">
      <div className="mx-auto grid max-w-7xl gap-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
              <Badge variant="secondary">Creator · บัญชีนำร่อง</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">ดูสิทธิ์เข้าถึง แคมเปญที่เปิด และผลโฆษณา Creator โดยไม่ต้องรอข้อความ LINE</p>
          </div>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => void overview.refetch()} disabled={overview.isFetching || stopPolling(overview.error)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> อัปเดตสถานะ
          </Button>
        </div>
        {overview.isPending ? <LoadingState label="กำลังตรวจสอบสิทธิ์และสถานะแคมเปญ…" /> : overview.isError ? (
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
            <Stats clients={data.clients} now={now} />
            {userId !== undefined && <CreatorRows key={userId} clients={data.clients} userId={userId} now={now} onRefreshCampaign={() => void overview.refetch()} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
